import type { Analytics, Product } from '../../api';
export interface SKU {id:string;label:string;capacity:string;color:string;price:number;price_source:string;stock:number|null;stock_source:string;recorded_at?:string}
export interface CatalogProduct extends Product {skus:SKU[];legacy?:boolean}
export interface LiveContext {session_id:string;session_version:number;session_title:string;campaign_id:string;item_id:string;product_id:string;sku_id:string;sku_label:string;product_snapshot:Product;price_source:string;promotion:string;promotion_source:string}
export interface LiveItem {id:string;product_id:string;sku_id:string;sku_label:string;product_snapshot:Product;price_source:string;stock:number|null;stock_source:string;recorded_at?:string;talking_points:string;promotion:string;promotion_source:string}
export interface LiveSession {id:string;campaign_id:string;title:string;host:string;goal:string;scheduled_start:string;scheduled_end:string;version:number;status:'draft'|'ready'|'archived';items:LiveItem[];history:LiveSession[]}
export interface LiveReport {id:string;live_session_id:string;title:string;created_at:string;conclusion:string;next_action:string;session_snapshot:LiveSession;analytics_snapshot:Analytics}
export const statusLabels={draft:'待核对货盘',ready:'货盘已确认',archived:'已归档'};
