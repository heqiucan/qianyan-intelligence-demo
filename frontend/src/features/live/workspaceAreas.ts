import {liveModules} from './modules';

// The original module list is the feature inventory; these are contextual entry points.
export const liveToolGroups = {
 video:{title:'画面设置',ids:['source','layers','filters','output']},
 scripts:{title:'话术设置',ids:['groups','variables','writing','autohost']},
 voice:{title:'播报设置',ids:['voices','hosts','rhythm','blocked','playlist','ambience']},
 interaction:{title:'互动设置',ids:['voice-keywords','timed','welcome','service','comments','control','text-keywords','simulation']},
 product:{title:'商品设置',ids:['cards']},
 more:{title:'更多工具',ids:['slicing','conversion','subtitles','models']},
};
export type LiveToolGroup = keyof typeof liveToolGroups;
export function isLiveToolGroup(value?:string): value is LiveToolGroup {
 return Boolean(value && Object.hasOwn(liveToolGroups,value));
}
export function featuresInGroup(group:LiveToolGroup){
 const ids:string[]=liveToolGroups[group].ids;
 return liveModules.flatMap(module=>module.features.filter(feature=>ids.includes(feature.id)).map(feature=>({module,feature})));
}
