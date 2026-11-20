"""Bounded local FFmpeg jobs. No ASR, remote URLs, shell commands or background auto-start."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from typing import Literal
from uuid import uuid4
import wave
import zipfile

from fastapi import File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator

MAX_BYTES = 100 * 1024 * 1024
MAX_STORAGE_BYTES = 1024 * 1024 * 1024
MAX_DURATION = 900
MAX_OUTPUTS = 100
FORMATS = 'wav,mp3,ogg,flac,mov,matroska,webm,aac,avi,mpegts,aiff,asf,amr'
EXTENSIONS = {'.wav','.mp3','.flac','.ogg','.opus','.m4a','.aac','.mp4','.mov','.webm','.mkv','.avi','.wma','.aiff','.amr'}


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


def read_record(db, key):
    row = db.execute("SELECT data FROM records WHERE collection='media_jobs' AND id=?",(key,)).fetchone()
    if not row: raise HTTPException(404,'素材处理任务不存在。')
    return json.loads(row[0])


def save_record(db, record):
    db.execute("INSERT INTO records(collection,id,data) VALUES ('media_jobs',?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data",(record['id'],json.dumps(record,ensure_ascii=False)))
    return record


def all_jobs(db):
    return [json.loads(row[0]) for row in db.execute("SELECT data FROM records WHERE collection='media_jobs' ORDER BY rowid DESC")]


def require_session(db,sid):
    if not db.execute("SELECT 1 FROM records WHERE collection='live_sessions' AND id=?",(sid,)).fetchone():raise HTTPException(404,'直播场次不存在。')


class Caption(BaseModel):
    start: float = Field(ge=0,le=MAX_DURATION,allow_inf_nan=False)
    end: float = Field(gt=0,le=MAX_DURATION,allow_inf_nan=False)
    text: str = Field(min_length=1,max_length=500)

    @model_validator(mode='after')
    def valid(self):
        if self.end <= self.start or not self.text.strip():raise ValueError('字幕结束时间必须晚于开始时间，正文不能为空。')
        if '-->' in self.text:raise ValueError('字幕正文不能包含时间轴分隔符。')
        return self


class CaptionsInput(BaseModel):
    expected_revision: int = Field(ge=1)
    source_index: int = Field(ge=0,le=4)
    captions: list[Caption] = Field(min_length=1,max_length=1000)


def srt_time(seconds):
    ms=round(seconds*1000);h,rem=divmod(ms,3600000);m,rem=divmod(rem,60000);s,ms=divmod(rem,1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'


def build_srt(captions,duration):
    prior=0;parts=[]
    for i,c in enumerate(captions,1):
        if c.start < prior or c.end > duration + .05:raise HTTPException(422,'字幕需按时间排序、不重叠，且不能超出所选素材时长。')
        prior=c.end;parts.append(f'{i}\n{srt_time(c.start)} --> {srt_time(c.end)}\n{c.text.strip()}\n')
    return '\n'.join(parts)


def slice_ranges(duration, silence_log, minimum, maximum):
    """Split at silence midpoints, not semantic/VAD inference. Keep all audio."""
    starts=[];silences=[]
    for line in silence_log.splitlines():
        start=re.search(r'silence_start: ([0-9.]+)',line)
        end=re.search(r'silence_end: ([0-9.]+)',line)
        if start:starts.append(float(start.group(1)))
        if end and starts:silences.append((starts.pop(0)+float(end.group(1)))/2)
    boundaries=[x for x in silences if 0 < x < duration]
    ranges=[];cursor=0.0
    while cursor < duration-.0001:
        limit=min(cursor+maximum,duration)
        candidates=[x for x in boundaries if cursor+minimum<=x<=limit and duration-x>=minimum]
        stop=max(candidates) if candidates else limit
        if duration-stop<minimum and duration-cursor<=maximum:stop=duration
        ranges.append((cursor,stop));cursor=stop
        if len(ranges)>MAX_OUTPUTS:raise RuntimeError('切片超过100段，请提高片段时长或缩短素材。')
    return ranges


class MediaRunner:
    def __init__(self,store):
        self.store=store;self.root=(store.directory/'media-tools').resolve();self.root.mkdir(parents=True,exist_ok=True)
        self.ffmpeg=shutil.which('ffmpeg');self.ffprobe=shutil.which('ffprobe')
        self.executor=ThreadPoolExecutor(max_workers=1,thread_name_prefix='local-media')
        self.lock=threading.RLock();self.uploads={};self.cancelled=set();self.processes={};self.recovered=False;self.closed=False

    def recover(self):
        with self.lock:
            if self.recovered:return
            with self.store.transaction() as db:
                for job in all_jobs(db):
                    if job['status'] in ('queued','running','cancelling'):
                        job.update(status='interrupted',error='服务重启中断了处理；请重新提交素材，不会自动重跑。',updated_at=timestamp())
                        save_record(db,job)
            self.recovered=True

    def stored_bytes(self):
        return sum(path.stat().st_size for path in self.root.rglob('*') if path.is_file())

    def reserve_upload(self,sid,key):
        # Count staging uploads before the first await, not only persisted jobs.
        # Each upload reserves the full per-batch bound until it becomes a job.
        with self.lock:
            if self.closed:raise HTTPException(503,'素材服务正在关闭，请稍后重试。')
            with self.store.read() as db:
                require_session(db,sid)
                active=sum(j['status'] in ('queued','running','cancelling') for j in all_jobs(db))
            if active+len(self.uploads)>=2:raise HTTPException(429,'已有素材正在上传、处理或排队，请等待后再提交。')
            if self.stored_bytes()+sum(self.uploads.values())+MAX_BYTES>MAX_STORAGE_BYTES:
                raise HTTPException(507,'已存素材与上传预留空间达到1GB准入阈值，请由管理员清理后继续。处理中输出仍可能增长。')
            self.uploads[key]=MAX_BYTES

    def check_cancel(self,key):
        if self.closed or key in self.cancelled:raise InterruptedError('已取消任务')

    def folder(self,key):
        if not re.fullmatch(r'media-[0-9a-f]{24}',key):raise HTTPException(404,'任务编号无效。')
        folder=(self.root/key).resolve()
        if folder.parent!=self.root:raise HTTPException(404,'路径不可用。')
        return folder

    def update(self,key,**fields):
        with self.store.transaction() as db:
            record=read_record(db,key);record.update(fields,updated_at=timestamp());save_record(db,record)
            return record

    def run_command(self,key,args,log_name,timeout=120):
        self.check_cancel(key);folder=self.folder(key)
        with (folder/log_name).open('wb') as log:
            process=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,cwd=folder,
                                     creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            with self.lock:self.processes[key]=process
            deadline=time.monotonic()+timeout
            try:
                while process.poll() is None:
                    self.check_cancel(key)
                    if time.monotonic()>deadline:raise TimeoutError('处理超时，请使用较短素材。')
                    time.sleep(.1)
                self.check_cancel(key)
                output=(folder/log_name).read_text(encoding='utf-8',errors='replace')[-2000000:]
                if process.returncode:raise RuntimeError('文件无法读取、没有音轨或编码不受支持，请更换素材。')
                return output
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:process.wait(timeout=3)
                    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=3)
                with self.lock:self.processes.pop(key,None)

    def process(self,key):
        try:
            self.check_cancel(key);job=self.update(key,status='running',progress=0)
            outputs=[];sources=[];folder=self.folder(key)
            for i,source in enumerate(job['sources']):
                self.check_cancel(key)
                path=folder/source['stored_name']
                probe=self.run_command(key,[self.ffprobe,'-v','error','-protocol_whitelist','file,pipe','-format_whitelist',FORMATS,'-show_entries','format=duration:stream=codec_type,duration','-of','json',str(path)],f'probe-{i}.log',20)
                info=json.loads(probe);audio_streams=[s for s in info.get('streams',[]) if s.get('codec_type')=='audio']
                if not audio_streams:raise RuntimeError('所选文件没有可读取音轨。')
                duration=float(info.get('format',{}).get('duration') or audio_streams[0].get('duration') or 0)
                if not math.isfinite(duration) or duration<=0 or duration>MAX_DURATION:raise RuntimeError('单个素材需有明确时长，且不超过15分钟。')
                wav=folder/f'normalized-{i+1}.wav'
                self.run_command(key,[self.ffmpeg,'-hide_banner','-nostdin','-y','-v','error','-protocol_whitelist','file,pipe','-format_whitelist',FORMATS,'-threads','2','-i',str(path),'-map','0:a:0','-vn','-sn','-dn','-t',str(MAX_DURATION),'-ac','1','-ar','24000','-c:a','pcm_s16le','-fs','50000000',str(wav)],f'convert-{i}.log')
                with wave.open(str(wav),'rb') as reader:
                    exact=reader.getnframes()/reader.getframerate()
                    if not reader.getnframes() or reader.getframerate()!=24000 or reader.getnchannels()!=1:raise RuntimeError('转换输出不符合单声道24kHz要求。')
                source={**source,'duration':exact};sources.append(source)
                outputs.append(dict(name=wav.name,label=f'{source["name"]} · 24kHz WAV',kind='audio',source_index=i,duration=exact))
                if job['mode']=='slice':
                    log=self.run_command(key,[self.ffmpeg,'-hide_banner','-nostdin','-v','info','-protocol_whitelist','file,pipe','-i',str(wav),'-af',f'silencedetect=noise={job["noise_db"]}dB:d={job["silence_ms"]/1000}','-f','null','-'],f'silence-{i}.log')
                    ranges=slice_ranges(exact,log,job['min_seconds'],job['max_seconds'])
                    with wave.open(str(wav),'rb') as reader:
                        for n,(start,end) in enumerate(ranges,1):
                            self.check_cancel(key);output=folder/f'source-{i+1}-clip-{n:03}.wav'
                            reader.setpos(round(start*24000));frames=reader.readframes(round(end*24000)-round(start*24000))
                            with wave.open(str(output),'wb') as writer:writer.setnchannels(1);writer.setsampwidth(2);writer.setframerate(24000);writer.writeframes(frames)
                            outputs.append(dict(name=output.name,label=f'{source["name"]} · 片段 {n}',kind='clip',source_index=i,start=round(start,3),end=round(end,3),duration=round(end-start,3)))
                self.update(key,progress=round((i+1)/len(job['sources'])*90))
            manifest=dict(task_id=key,mode=job['mode'],sample_rate=24000,channels=1,algorithm='FFmpeg silencedetect; silence-midpoint segmentation' if job['mode']=='slice' else 'FFmpeg resampling',sources=sources,outputs=outputs,asr=False,created_at=timestamp())
            (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
            with zipfile.ZipFile(folder/'results.zip','w',compression=zipfile.ZIP_DEFLATED) as archive:
                for output in outputs:self.check_cancel(key);archive.write(folder/output['name'],output['name'])
                archive.write(folder/'manifest.json','manifest.json')
            with self.lock:
                self.check_cancel(key);self.update(key,status='completed',progress=100,sources=sources,outputs=outputs,error='')
        except InterruptedError:self.update(key,status='cancelled',error='任务已取消，部分输出不作为完成结果下载。')
        except Exception as exc:self.update(key,status='failed',error=str(exc)[:350] if isinstance(exc,(RuntimeError,TimeoutError)) else '处理失败，请检查文件格式并重新提交。')

    def cancel(self,key):
        with self.lock:
            with self.store.transaction() as db:
                job=read_record(db,key)
                if job['status'] not in ('queued','running','cancelling'):return job
                self.cancelled.add(key);job.update(status='cancelling',updated_at=timestamp());save_record(db,job)
            return job

    def shutdown(self):
        with self.lock:self.closed=True
        self.executor.shutdown(wait=True,cancel_futures=False)


def register_media_tools(app,store):
    runner=MediaRunner(store);app.state.media_runner=runner

    @app.get('/api/live/media/capabilities')
    def capabilities():
        runner.recover()
        return dict(ffmpeg=bool(runner.ffmpeg),ffprobe=bool(runner.ffprobe),asr=False,max_files=5,max_bytes=MAX_BYTES,max_duration=MAX_DURATION,
                    message='使用本机 FFmpeg，输出单声道24kHz WAV；切片基于静音阈值，不是语义识别。自动语音转写尚未接入，字幕由人工录入时间轴。')

    @app.get('/api/live/media/{sid}/jobs')
    def jobs(sid:str):
        runner.recover()
        with store.read() as db:require_session(db,sid);return [j for j in all_jobs(db) if j['session_id']==sid][:30]

    @app.post('/api/live/media/{sid}/jobs')
    async def create(sid:str,files:list[UploadFile]=File(...),mode:Literal['convert','slice']=Form('convert'),min_seconds:float=Form(1,ge=.1,le=60),max_seconds:float=Form(30,ge=1,le=300),noise_db:int=Form(-35,ge=-70,le=-10),silence_ms:int=Form(500,ge=100,le=5000)):
        key='media-'+uuid4().hex[:24];folder=None;accepted=False
        try:
            runner.recover()
            if not runner.ffmpeg or not runner.ffprobe:raise HTTPException(503,'未找到本机 FFmpeg/ffprobe，请安装后重新启动服务。')
            if not math.isfinite(min_seconds) or not math.isfinite(max_seconds) or len(files)<1 or len(files)>5 or min_seconds>max_seconds:raise HTTPException(422,'每次选择1–5个文件，最短片段不能大于最长片段。')
            runner.reserve_upload(sid,key)
            folder=runner.folder(key);folder.mkdir()
            total=0;sources=[]
            for i,file in enumerate(files):
                name=Path((file.filename or 'media').replace('\\','/')).name[:160];extension=Path(name).suffix.lower()
                if extension not in EXTENSIONS:raise HTTPException(415,'仅支持常见音视频文件，不接受播放列表、压缩包或网络地址。')
                stored=f'input-{i}{extension}';digest=hashlib.sha256();size=0
                with (folder/stored).open('wb') as output:
                    while chunk:=await file.read(1024*1024):
                        runner.check_cancel(key)
                        total+=len(chunk);size+=len(chunk)
                        if total>MAX_BYTES:raise HTTPException(413,'每批文件总大小不能超过100MB。')
                        digest.update(chunk);output.write(chunk)
                if size==0:raise HTTPException(422,'不能提交空文件。')
                sources.append(dict(name=name,stored_name=stored,sha256=digest.hexdigest(),bytes=size))
            record=dict(id=key,session_id=sid,mode=mode,min_seconds=min_seconds,max_seconds=max_seconds,noise_db=noise_db,silence_ms=silence_ms,sources=sources,outputs=[],progress=0,status='queued',error='',created_at=timestamp(),updated_at=timestamp(),subtitle_revision=1,captions=[])
            with runner.lock:
                if runner.closed:raise HTTPException(503,'素材服务正在关闭，请稍后重试。')
                with store.transaction() as db:
                    active=sum(j['status'] in ('queued','running','cancelling') for j in all_jobs(db))
                    if key not in runner.uploads or active+len(runner.uploads)>2:raise HTTPException(429,'队列已满，请稍后重试。')
                    save_record(db,record)
                try:
                    runner.executor.submit(runner.process,key)
                except Exception:
                    with store.transaction() as db:db.execute("DELETE FROM records WHERE collection='media_jobs' AND id=?",(key,))
                    raise
                # Persisted queued job replaces its staging reservation atomically.
                runner.uploads.pop(key,None);accepted=True
            return record
        except BaseException:
            # Only this newly created, verified task directory can be removed.
            if not accepted and folder is not None and folder.is_dir():
                for path in folder.iterdir():
                    if path.is_file():path.unlink()
                folder.rmdir()
            raise
        finally:
            with runner.lock:runner.uploads.pop(key,None)
            for file in files:await file.close()

    @app.post('/api/live/media/jobs/{key}/cancel')
    def cancel(key:str):
        runner.recover();runner.folder(key);return runner.cancel(key)

    @app.get('/api/live/media/jobs/{key}/files/{name}')
    def download(key:str,name:str):
        runner.recover();folder=runner.folder(key)
        with store.read() as db:
            job=read_record(db,key)
            if job['status']!='completed':raise HTTPException(409,'任务尚未完成，没有可下载结果。')
            allowed={o['name'] for o in job['outputs']}|{'results.zip','manifest.json'}
            if job.get('captions'):allowed.add('manual-subtitles.srt')
            if name not in allowed:raise HTTPException(404,'输出文件不存在。')
        path=(folder/name).resolve()
        if path.parent!=folder or not path.is_file():raise HTTPException(404,'输出文件不存在。')
        return FileResponse(path,filename=name,media_type='audio/wav' if path.suffix=='.wav' else 'application/octet-stream')

    @app.put('/api/live/media/jobs/{key}/subtitles')
    def subtitles(key:str,body:CaptionsInput):
        folder=runner.folder(key)
        with store.transaction() as db:
            job=read_record(db,key)
            if job['status']!='completed':raise HTTPException(409,'请先完成音频处理。')
            if body.expected_revision!=job['subtitle_revision']:raise HTTPException(409,'字幕已变化，请刷新任务后重试。')
            if body.source_index>=len(job['sources']):raise HTTPException(422,'字幕素材不存在。')
            content=build_srt(body.captions,job['sources'][body.source_index]['duration'])
            (folder/'manual-subtitles.srt').write_text(content,encoding='utf-8-sig')
            job.update(captions=[c.model_dump() for c in body.captions],subtitle_source=body.source_index,subtitle_revision=job['subtitle_revision']+1,updated_at=timestamp())
            return save_record(db,job)
    return runner
