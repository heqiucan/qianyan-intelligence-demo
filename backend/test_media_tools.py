"""Real FFmpeg acceptance plus bounded validation/restart/cancel contracts."""
from contextlib import asynccontextmanager
from io import BytesIO
import json
import math
import shutil
import struct
import time
import wave
import zipfile
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.main import Store,put
from backend.media_tools import register_media_tools,slice_ranges,build_srt,Caption


def wav_bytes(duration=3):
    memory=BytesIO();rate=44100
    with wave.open(memory,'wb') as w:
        w.setnchannels(2);w.setsampwidth(2);w.setframerate(rate)
        values=bytearray()
        for n in range(int(rate*duration)):
            value=int(5000*math.sin(2*math.pi*440*n/rate)) if (n/rate)%1<.5 else 0
            values.extend(struct.pack('<hh',value,value))
        w.writeframes(values)
    return memory.getvalue()


@pytest.fixture
def media(tmp_path):
    store=Store(tmp_path);store.initialize()
    with store.transaction() as db:put(db,'live_sessions',dict(id='session-media'))
    app=FastAPI();runner=register_media_tools(app,store)
    with TestClient(app) as client:
        yield client,runner,store
    runner.shutdown()


def wait(client,key):
    deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        jobs=client.get('/api/live/media/session-media/jobs').json();job=next(j for j in jobs if j['id']==key)
        if job['status'] not in ['queued','running','cancelling']:return job
        time.sleep(.05)
    raise AssertionError('media task timeout')


def test_real_conversion_slice_download_and_subtitles(media):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):pytest.skip('FFmpeg not installed')
    c,runner,store=media
    response=c.post('/api/live/media/session-media/jobs',files=[('files',('你好.wav',wav_bytes(),'audio/wav')),('files',('second.wav',wav_bytes(2),'audio/wav'))],data=dict(mode='slice',min_seconds=.2,max_seconds=1.5,silence_ms=200,noise_db=-35))
    assert response.status_code==200,response.text;job=wait(c,response.json()['id']);assert job['status']=='completed',job
    assert len(job['sources'])==2 and all(o['duration']<=1.501 for o in job['outputs'] if o['kind']=='clip')
    response=c.get(f'/api/live/media/jobs/{job["id"]}/files/normalized-1.wav');assert response.status_code==200
    with wave.open(BytesIO(response.content),'rb') as w:assert w.getnchannels()==1 and w.getframerate()==24000 and w.getnframes()>0
    archive=c.get(f'/api/live/media/jobs/{job["id"]}/files/results.zip')
    with zipfile.ZipFile(BytesIO(archive.content)) as z:
        manifest=json.loads(z.read('manifest.json'));assert manifest['asr'] is False and manifest['sources'][0]['sha256']
        assert 'normalized-1.wav' in z.namelist()
    body=dict(expected_revision=1,source_index=0,captions=[dict(start=0,end=1,text='人工字幕第一行'),dict(start=1,end=2,text='第二行')])
    saved=c.put(f'/api/live/media/jobs/{job["id"]}/subtitles',json=body);assert saved.status_code==200,saved.text
    srt=c.get(f'/api/live/media/jobs/{job["id"]}/files/manual-subtitles.srt');assert '00:00:00,000 --> 00:00:01,000' in srt.text and '人工字幕第一行' in srt.text
    assert c.put(f'/api/live/media/jobs/{job["id"]}/subtitles',json=body).status_code==409
    body.update(expected_revision=2,captions=[dict(start=0,end=10,text='超时')]);assert c.put(f'/api/live/media/jobs/{job["id"]}/subtitles',json=body).status_code==422
    assert c.get(f'/api/live/media/jobs/{job["id"]}/files/input-0.wav').status_code==404


def test_validation_and_invalid_file_failure(media):
    c,runner,store=media
    assert c.post('/api/live/media/no-session/jobs',files={'files':('x.wav',b'x')}).status_code==404
    assert c.post('/api/live/media/session-media/jobs',files={'files':('x.m3u8',b'http://example.com')}).status_code==415
    assert c.post('/api/live/media/session-media/jobs',files={'files':('x.wav',b'')}).status_code==422
    assert c.post('/api/live/media/session-media/jobs',files={'files':('x.wav',b'x')},data=dict(min_seconds=10,max_seconds=1)).status_code==422
    response=c.post('/api/live/media/session-media/jobs',files={'files':('broken.mp4',b'not media')})
    job=wait(c,response.json()['id']);assert job['status']=='failed' and job['error']
    assert c.get(f'/api/live/media/jobs/{job["id"]}/files/results.zip').status_code==409


def test_cancel_and_restart(media,monkeypatch):
    c,runner,store=media
    def slow(key,*args,**kwargs):
        for _ in range(100):runner.check_cancel(key);time.sleep(.01)
        return '{}'
    monkeypatch.setattr(runner,'run_command',slow)
    response=c.post('/api/live/media/session-media/jobs',files={'files':('x.wav',wav_bytes(1))});key=response.json()['id']
    assert c.post(f'/api/live/media/jobs/{key}/cancel').status_code==200
    assert wait(c,key)['status']=='cancelled'
    with store.transaction() as db:put(db,'media_jobs',dict(id='media-'+'a'*24,session_id='session-media',status='running'))
    runner.recovered=False;c.get('/api/live/media/capabilities')
    assert any(j['status']=='interrupted' for j in c.get('/api/live/media/session-media/jobs').json())


def test_segment_bounds_and_caption_validation():
    log='silence_start: 1.0\nsilence_end: 2.0\nsilence_start: 4.0\nsilence_end: 5.0'
    parts=slice_ranges(10,log,1,3)
    assert parts[0]==(0,1.5) and parts[-1][1]==10 and all(b-a<=3 for a,b in parts)
    assert all(parts[n][1]==parts[n+1][0] for n in range(len(parts)-1))
    with pytest.raises(Exception):build_srt([Caption(start=0,end=2,text='一'),Caption(start=1,end=3,text='重叠')],5)


def test_real_video_audio_extraction(media,tmp_path):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):pytest.skip('FFmpeg not installed')
    import subprocess
    c,runner,store=media
    video=tmp_path/'fixture.mp4'
    subprocess.run([shutil.which('ffmpeg'),'-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=black:s=160x90:r=10','-f','lavfi','-i','sine=frequency=500:sample_rate=48000','-t','1','-c:v','mpeg4','-c:a','aac',str(video)],check=True,capture_output=True,timeout=15)
    response=c.post('/api/live/media/session-media/jobs',files={'files':('fixture.mp4',video.read_bytes(),'video/mp4')})
    assert response.status_code==200,response.text
    job=wait(c,response.json()['id']);assert job['status']=='completed',job
    result=c.get(f'/api/live/media/jobs/{job["id"]}/files/normalized-1.wav')
    with wave.open(BytesIO(result.content),'rb') as w:
        assert w.getnchannels()==1 and w.getframerate()==24000 and .9<w.getnframes()/24000<1.2


def test_upload_reservation_counts_staging_before_await(media,monkeypatch):
    import asyncio
    from fastapi import UploadFile,HTTPException
    c,runner,store=media
    endpoint=next(route.endpoint for route in c.app.routes if getattr(route,'path','')=='/api/live/media/{sid}/jobs' and 'POST' in route.methods)
    monkeypatch.setattr(runner,'process',lambda key:runner.update(key,status='completed'))
    async def scenario():
        release=asyncio.Event();both_started=asyncio.Event();started=[]
        class SlowUpload(UploadFile):
            async def read(self,size=-1):
                if self.filename not in started:
                    started.append(self.filename)
                    if len(started)==2:both_started.set()
                    await release.wait()
                return await super().read(size)
        async def submit(name):
            return await endpoint('session-media',[SlowUpload(BytesIO(b'upload'),filename=name)],'convert',1,30,-35,500)
        first=asyncio.create_task(submit('first.wav'));second=asyncio.create_task(submit('second.wav'))
        await asyncio.wait_for(both_started.wait(),2)
        assert len(runner.uploads)==2
        with pytest.raises(HTTPException) as error:await submit('third.wav')
        assert error.value.status_code==429 and 'third.wav' not in started
        assert len(list(runner.root.iterdir()))==2
        release.set();results=await asyncio.gather(first,second)
        assert len(results)==2 and not runner.uploads
    asyncio.run(scenario())


def test_upload_reservation_released_on_cancel_and_validation(media):
    import asyncio
    from fastapi import UploadFile,HTTPException
    c,runner,store=media
    endpoint=next(route.endpoint for route in c.app.routes if getattr(route,'path','')=='/api/live/media/{sid}/jobs' and 'POST' in route.methods)
    async def scenario():
        entered=asyncio.Event();release=asyncio.Event()
        class SlowUpload(UploadFile):
            async def read(self,size=-1):entered.set();await release.wait();return await super().read(size)
        upload=SlowUpload(BytesIO(b'data'),filename='cancel.wav')
        task=asyncio.create_task(endpoint('session-media',[upload],'convert',1,30,-35,500))
        await asyncio.wait_for(entered.wait(),2);assert len(runner.uploads)==1
        task.cancel()
        with pytest.raises(asyncio.CancelledError):await task
        assert not runner.uploads and not list(runner.root.iterdir()) and upload.file.closed
        with pytest.raises(HTTPException):await endpoint('session-media',[UploadFile(BytesIO(b'bad'),filename='bad.m3u8')],'convert',1,30,-35,500)
        assert not runner.uploads and not list(runner.root.iterdir())
    asyncio.run(scenario())


def test_upload_admission_includes_reserved_bytes(media,monkeypatch):
    from fastapi import HTTPException
    from backend.media_tools import MAX_BYTES,MAX_STORAGE_BYTES
    c,runner,store=media;runner.recover()
    monkeypatch.setattr(runner,'stored_bytes',lambda:MAX_STORAGE_BYTES-MAX_BYTES-10)
    runner.reserve_upload('session-media','first')
    with pytest.raises(HTTPException) as error:runner.reserve_upload('session-media','second')
    assert error.value.status_code==507 and runner.uploads=={'first':MAX_BYTES}
    runner.uploads.clear()
