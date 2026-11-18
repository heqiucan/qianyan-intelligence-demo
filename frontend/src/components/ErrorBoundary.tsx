import {Component,type ReactNode} from 'react';

export default class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 render(){
  if(!this.state.failed)return this.props.children;
  return <main className="page"><section className="panel" role="alert"><h1>页面暂时无法显示</h1><p>已保存的业务数据仍在本机。刷新页面后先核对结果；未保存的编辑可能需要重新填写。</p><div className="row-actions"><button className="button primary" onClick={()=>location.reload()}>重新加载当前页面</button><button className="button secondary" onClick={()=>{location.hash='#/overview';location.reload()}}>返回工作台</button></div></section></main>;
 }
}
