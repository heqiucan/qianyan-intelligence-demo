export interface ScriptLine {text:string;role:'host'|'assistant'}
export interface ScriptGroup {id:string;name:string;version:number;campaign_id:string;lines:ScriptLine[]}
export interface VoiceConfig {voice:string;rate:number;volume:number}
export interface SpeechSettings {id:string;version:number;host:VoiceConfig;assistant:VoiceConfig;gap_ms:number}
export interface Clip extends VoiceConfig {id:string;text:string;role:'host'|'assistant';gap_ms:number;blocked:boolean;line_index:number}
export interface SpeechQueue {id:string;session_id:string;session_version:number;group_id:string;group_version:number;group_name:string;kind:string;entries:Clip[];created_at:string}
export interface SpeechLog {id:string;action:string;detail:string;queue_id:string;created_at:string}
export interface SpeechWorkspace {groups:ScriptGroup[];settings:SpeechSettings;blocks:{version:number;words:string[]};queue:SpeechQueue|null;logs:SpeechLog[]}
export interface SystemVoice {id:string;name:string;language:string;gender:string}
