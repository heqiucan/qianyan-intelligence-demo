export type Act=(fn:()=>Promise<unknown>,success?:string)=>Promise<boolean>;
export const names:Record<string,string>={draft:'草稿',approved:'已确认',running:'模拟运行中',paused:'已暂停',ended:'已结束',applied:'已应用'};
export const buyers:Record<string,string>={new:'新客',returning:'老客',unknown:'历史未知'};
export const today=()=>new Date().toISOString().slice(0,10);
export const later=()=>new Date(Date.now()+7*86400000).toISOString().slice(0,10);
