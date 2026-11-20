export interface LiveFeature {id:string;name:string;description:string;stage:number;available?:boolean;availabilityLabel?:string}
export interface LiveModule {id:string;name:string;features:LiveFeature[]}
export const liveModules:LiveModule[] = [
 {id:'ai',name:'AI 主播',features:[
  {id:'console',name:'直播控制台',description:'管理本场账号、商品货盘、模拟运行与操作日志。',stage:1,available:true},
  {id:'voices',name:'音色库',description:'选择服务器已安装的 Windows 音色，生成试听并导出 WAV。音色克隆未接入。',stage:2,available:true,availabilityLabel:'本地播报可用'},
  {id:'hosts',name:'主播与助播',description:'逐句指定角色，分别设置音色、音量和语速。',stage:2,available:true,availabilityLabel:'本地播报可用'},
  {id:'voice-keywords',name:'关键词语音回复',description:'弹幕命中关键词时，将对应话术加入语音队列。',stage:3,available:true,availabilityLabel:'本地规则可用'},
  {id:'timed',name:'插播报时',description:'按设定间隔在本地插播已确认话术，可引用当前时间；页面隐藏或模拟暂停后停止。',stage:3,available:true,availabilityLabel:'定时模拟可用'},
  {id:'welcome',name:'进间关注',description:'根据观众进场或关注事件播放欢迎与感谢话术。',stage:3,available:true,availabilityLabel:'本地规则可用'},
  {id:'service',name:'智能客服接管',description:'规则未命中、资料缺失或失效时转人工；生成式智能客服尚未接入。',stage:3,available:true,availabilityLabel:'本地规则可用'},
  {id:'comments',name:'弹幕显示与过滤',description:'独立查看弹幕、手动发言，过滤表情并管理忽略用户。',stage:3},
  {id:'interrupt',name:'临时插话',description:'输入文字临时播报；麦克风插话在音频工具阶段接入。',stage:2,available:true,availabilityLabel:'本地播报可用'},
  {id:'blocked',name:'语音全局屏蔽词',description:'语音生成前检查屏蔽词，供 AI 主播和 AI 替你播共用。',stage:2,available:true,availabilityLabel:'本地播报可用'},
  {id:'rhythm',name:'播报节奏与音量闪避',description:'句间停顿、角色语速音量可配置；主副音频与环境音支持播报时降低音量。',stage:2,available:true,availabilityLabel:'本地播报可用'},
  {id:'cards',name:'商品弹窗与自动补链接',description:'先模拟话术关联商品卡和补链接，真实操作须经平台权限验证。',stage:3},
  {id:'slicing',name:'音频碎片化',description:'使用本机 FFmpeg 按静音切分，控制片长并下载；语义及关键词切片未接入。',stage:4,available:true,availabilityLabel:'静音切片可用'},
  {id:'conversion',name:'音频批量转换',description:'批量上传本地音视频并转换为单声道24kHz WAV，支持取消和下载结果。',stage:4,available:true,availabilityLabel:'本地转换可用'},
  {id:'subtitles',name:'SRT 字幕生成',description:'人工填写字幕与时间戳后导出SRT；自动语音识别模型尚未接入。',stage:4,available:true,availabilityLabel:'人工SRT可用'},
  {id:'simulation',name:'本地互动模拟',description:'手动模拟弹幕、进场和关注，查看本场已保存的测试事件。',stage:1,available:true},
 ]},
 {id:'scripts',name:'话术管理',features:[
  {id:'groups',name:'话术分组与编辑',description:'分组编辑、排序主播与助播话术，支持 TXT/CSV 导入导出并准备播报队列。',stage:2,available:true,availabilityLabel:'本地播报可用'},
  {id:'variables',name:'主播话术改写与变量',description:'商品变量替换与有来源的草稿改写；必须人工确认，默认回放模板不称为AI生成。',stage:2,available:true,availabilityLabel:'变量与草稿可用'},
 ]},
 {id:'video',name:'视频去重',features:[
  {id:'source',name:'视频来源与预览',description:'预览本地文件或摄像头，选择设备与目标分辨率；OBS 和平台输出尚未接入。',stage:4,available:true,availabilityLabel:'本地预览可用'},
  {id:'layers',name:'双图层叠加',description:'两路本地图片或视频图层，调整可见度、缩放、位置与方向；仅预览。',stage:4,available:true,availabilityLabel:'本地图层可用'},
  {id:'filters',name:'音视频滤镜',description:'调整本地预览亮度、对比度、饱和度、灰度与色相；不含美颜SDK、变调或平台输出。',stage:4,available:true,availabilityLabel:'画面滤镜可用'},
  {id:'output',name:'环境检测与直播输出',description:'检测运行环境与设备，并验证目标直播工具的输出兼容性。',stage:4},
 ]},
 {id:'text',name:'文字客服',features:[
  {id:'control',name:'文字场控',description:'固定文案按顺序或随机定时写入本地结果，不发送真实平台公屏。',stage:3,available:true,availabilityLabel:'本地场控可用'},
  {id:'text-keywords',name:'关键词文字回复',description:'设置关键词回复、发送及去重间隔，配置是否提及观众。',stage:3,available:true,availabilityLabel:'本地规则可用'},
 ]},
 {id:'audio',name:'智能语音',features:[
  {id:'playlist',name:'主副音频编排',description:'选择主副音频文件列表，设置间隔与音量，显式播放；不向平台输出。',stage:4,available:true,availabilityLabel:'本地编排可用'},
  {id:'ambience',name:'环境音',description:'三组本地环境音独立播放、间隔和音量，支持本地播报音量闪避。',stage:4,available:true,availabilityLabel:'本地环境音可用'},
 ]},
 {id:'services',name:'更多服务',features:[
  {id:'autohost',name:'AI 替你播',description:'结合话术与商品资料，编排主播、助播、欢迎、回复及发言频率。',stage:4},
  {id:'writing',name:'话术改写与新写',description:'依据已确认货盘新写草稿或参考已保存话术组改写，经人工确认导入新组；默认本地模板，真实模型使用当前配置。',stage:4,available:true,availabilityLabel:'草稿助手可用'},
  {id:'models',name:'AI 模型对接',description:'后续提供火山引擎、通义千问等配置入口，按任务选择模型。',stage:4},
 ]},
];
