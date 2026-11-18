export interface LiveFeature {id:string;name:string;description:string;stage:number;available?:boolean}
export interface LiveModule {id:string;name:string;features:LiveFeature[]}
export const liveModules:LiveModule[] = [
 {id:'ai',name:'AI 主播',features:[
  {id:'console',name:'直播控制台',description:'管理本场账号、商品货盘、模拟运行与操作日志。',stage:1,available:true},
  {id:'voices',name:'音色库',description:'试听示例音色，后续支持使用已获授权的参考音频创建自定义音色。',stage:2},
  {id:'hosts',name:'主播与助播',description:'逐句指定角色，分别设置音色、音量和语速。',stage:2},
  {id:'voice-keywords',name:'关键词语音回复',description:'弹幕命中关键词时，将对应话术加入语音队列。',stage:3},
  {id:'timed',name:'插播报时',description:'按间隔插播话术，引用时间和有来源的场次信息。',stage:3},
  {id:'welcome',name:'进间关注',description:'根据观众进场或关注事件播放欢迎与感谢话术。',stage:3},
  {id:'service',name:'智能客服接管',description:'依据本场商品价格、规格、发货及售后资料回答问题。',stage:3},
  {id:'comments',name:'弹幕显示与过滤',description:'独立查看弹幕、手动发言，过滤表情并管理忽略用户。',stage:3},
  {id:'interrupt',name:'临时插话',description:'输入文字临时播报；麦克风插话在音频工具阶段接入。',stage:2},
  {id:'blocked',name:'语音全局屏蔽词',description:'语音生成前检查屏蔽词，供 AI 主播和 AI 替你播共用。',stage:2},
  {id:'rhythm',name:'播报节奏与音量闪避',description:'配置停顿、尾部留白与暂停方式；音量闪避在音频编排阶段补齐。',stage:2},
  {id:'cards',name:'商品弹窗与自动补链接',description:'先模拟话术关联商品卡和补链接，真实操作须经平台权限验证。',stage:3},
  {id:'slicing',name:'音频碎片化',description:'按停顿切分素材，设置片段时长、截断与关键词过滤。',stage:4},
  {id:'conversion',name:'音频批量转换',description:'将音视频素材批量转为单声道 24 kHz WAV。',stage:4},
  {id:'subtitles',name:'SRT 字幕生成',description:'识别音频并按停顿和语义生成字幕，调整断句。',stage:4},
  {id:'simulation',name:'本地互动模拟',description:'手动模拟弹幕、进场和关注，查看本场已保存的测试事件。',stage:1,available:true},
 ]},
 {id:'scripts',name:'话术管理',features:[
  {id:'groups',name:'话术分组与编辑',description:'分组管理各类话术，支持编辑、试听、批量操作和导入导出。',stage:2},
  {id:'variables',name:'主播话术改写与变量',description:'逐条或批量改写主播话术，并设置替换变量。',stage:2},
 ]},
 {id:'video',name:'视频去重',features:[
  {id:'source',name:'视频来源与预览',description:'选择 OBS、本地文件或摄像头，设置分辨率并预览画面。',stage:4},
  {id:'layers',name:'双图层叠加',description:'叠加视频、网页或特效，调整可见度、缩放、方向和位置。',stage:4},
  {id:'filters',name:'音视频滤镜',description:'处理画面滤镜和音频变调，不承诺改变平台的重复内容判定。',stage:4},
  {id:'output',name:'环境检测与直播输出',description:'检测运行环境与设备，并验证目标直播工具的输出兼容性。',stage:4},
 ]},
 {id:'text',name:'文字客服',features:[
  {id:'control',name:'文字场控',description:'分组管理固定文案，按间隔顺序或随机发送到模拟公屏。',stage:3},
  {id:'text-keywords',name:'关键词文字回复',description:'设置关键词回复、发送及去重间隔，配置是否提及观众。',stage:3},
 ]},
 {id:'audio',name:'智能语音',features:[
  {id:'playlist',name:'主副音频编排',description:'设置主副音频的播放、插播间隔、音量和滤镜。',stage:4},
  {id:'ambience',name:'环境音',description:'分别配置三组环境音的启停、间隔和音量。',stage:4},
 ]},
 {id:'services',name:'更多服务',features:[
  {id:'autohost',name:'AI 替你播',description:'结合话术与商品资料，编排主播、助播、欢迎、回复及发言频率。',stage:4},
  {id:'writing',name:'话术改写与新写',description:'导入音视频或文本进行改写，或依据商品资料生成新话术。',stage:4},
  {id:'models',name:'AI 模型对接',description:'后续提供火山引擎、通义千问等配置入口，按任务选择模型。',stage:4},
 ]},
];
