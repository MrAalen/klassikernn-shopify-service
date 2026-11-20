'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=__dirname, PORT=Number(process.env.PORT||3000), HOST=process.env.HOST||'127.0.0.1';
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'', SHOPIFY_SECRET=process.env.SHOPIFY_CLIENT_SECRET||'', OVERLAY_KEY=process.env.OVERLAY_KEY||'', SESSION_KEY=process.env.SESSION_KEY||'', SHOP_DOMAIN=(process.env.SHOP_DOMAIN||'').toLowerCase();
if(!ADMIN_PASSWORD||!SHOPIFY_SECRET||!OVERLAY_KEY||!SESSION_KEY||!SHOP_DOMAIN){console.error('Missing required environment variables. See README.md');process.exit(1)}
const DATA=path.join(process.env.DATA_DIR||ROOT,'queue-data.json');fs.mkdirSync(path.dirname(DATA),{recursive:true}); let db={items:[],seen:[]}; try{db=JSON.parse(fs.readFileSync(DATA,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
const validStates=['waiting','opening','done','cancelled','review'];
const loginFails=new Map();
setInterval(()=>{const now=Date.now();for(const [k,v] of loginFails)if(now-v.ts>15*60*1000)loginFails.delete(k)},60000).unref();
function save(){let temp=DATA+'.tmp';fs.writeFileSync(temp,JSON.stringify(db,null,2),{mode:0o600});fs.renameSync(temp,DATA)}
function json(res,status,data,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(data))}
function hmac(x){return crypto.createHmac('sha256',SESSION_KEY).update(x).digest('hex')}
function eq(a,b){let x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
function auth(req){const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(x=>x.startsWith('kn_session='));if(!cookie)return false;const token=decodeURIComponent(cookie.split('=').slice(1).join('='));const [expiry,sig]=token.split('.');return Boolean(expiry&&sig&&Number(expiry)>Date.now()&&eq(sig,hmac(expiry)))}
function originOk(req){const o=req.headers.origin;if(!o)return true;try{const url=new URL(o);return url.host===req.headers.host&&['http:','https:'].includes(url.protocol)}catch{return false}}
function receive(req){return new Promise((resolve,reject)=>{let chunks=[],size=0;req.on('data',b=>{size+=b.length;if(size>1024*1024){reject(new Error('too large'));req.destroy()}else chunks.push(b)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject)})}
function publicItems(){return db.items.filter(x=>!['done','cancelled'].includes(x.status)).map(({id,label,products,status,createdAt})=>({id,label,products,status,createdAt}))}
function safeStr(value,max=90){return String(value??'').replace(/[\r\n\t<>]/g,' ').trim().slice(0,max)}
function property(line,name){const props=Array.isArray(line.properties)?line.properties:[];const p=props.find(p=>String(p.name||'').trim().toLocaleLowerCase('nb-NO')===name.toLocaleLowerCase('nb-NO'));return safeStr(p?.value||'',100)}
function productsFrom(order){return (Array.isArray(order.line_items)?order.line_items:[]).map(x=>{
 // Shopify line-item property. New label takes priority, old label remains supported.
 const live=property(x,'Åpnes på stream') || property(x,'Åpnes på live');
 const delivery=property(x,'Levering');
 const liveChoice=/^(ja|yes|true|1)$/i.test(live)?'yes':/^(nei|no|false|0)$/i.test(live)?'no':'unknown';
 return {title:safeStr(x.variant_title&&x.variant_title!=='Default Title'?`${x.title} – ${x.variant_title}`:x.title,80),quantity:Math.max(1,Math.min(9999,Number(x.quantity)||1)),sku:safeStr(x.sku,48),liveChoice,delivery};
 }).filter(x=>x.title).slice(0,100)}
function item(id,label,products,orderId=null){return {id,label,products,orderId,status:'waiting',createdAt:new Date().toISOString(),notes:''}}
function staticFile(res,file,type){fs.readFile(path.join(ROOT,'public',file),(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors *"});res.end(data)})}
const server=http.createServer(async(req,res)=>{res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('X-Content-Type-Options','nosniff');let url;try{url=new URL(req.url,'http://localhost')}catch{return json(res,400,{error:'Bad URL'})}
try{
 if(req.method==='GET'&&url.pathname==='/')return res.writeHead(302,{Location:'/admin'}).end();
 if(req.method==='GET'&&url.pathname==='/overlay')return staticFile(res,'overlay.html','text/html; charset=utf-8');
 if(req.method==='GET'&&url.pathname==='/admin')return staticFile(res,'admin.html','text/html; charset=utf-8');
 if(req.method==='GET'&&url.pathname==='/style.css')return staticFile(res,'style.css','text/css; charset=utf-8');
 if(req.method==='GET'&&url.pathname==='/overlay.js')return staticFile(res,'overlay.js','text/javascript; charset=utf-8');
 if(req.method==='GET'&&url.pathname==='/admin.js')return staticFile(res,'admin.js','text/javascript; charset=utf-8');
 if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true});
 if(req.method==='GET'&&url.pathname==='/api/queue'){if(!eq(url.searchParams.get('key')||'',OVERLAY_KEY)&&!auth(req))return json(res,401,{error:'Unauthorized'});return json(res,200,{items:publicItems()})}
 if(req.method==='POST'&&['/webhooks/orders-paid','/webhooks/orders-cancelled','/webhooks/refunds-create'].includes(url.pathname)){
  const topicForPath={'/webhooks/orders-paid':'orders/paid','/webhooks/orders-cancelled':'orders/cancelled','/webhooks/refunds-create':'refunds/create'};
  const topic=topicForPath[url.pathname];
  const raw=await receive(req),signature=req.headers['x-shopify-hmac-sha256']||'';
  const expected=crypto.createHmac('sha256',SHOPIFY_SECRET).update(raw).digest('base64');
  if(!eq(signature,expected))return json(res,401,{error:'Invalid signature'});
  if(String(req.headers['x-shopify-shop-domain']||'').toLowerCase()!==SHOP_DOMAIN)return json(res,403,{error:'Wrong shop'});
  if(req.headers['x-shopify-topic']!==topic)return json(res,400,{error:'Unexpected topic'});
  const order=JSON.parse(raw.toString('utf8'));
  const key=String(topic==='refunds/create'?order.order_id:order.id||'');
  if(!key||key==='undefined')return json(res,400,{error:'Missing order ID'});
  const existing=db.items.find(x=>x.orderId===key);
  if(topic==='orders/cancelled'){
   if(existing&&existing.status!=='done'){existing.status='cancelled';existing.notes='Kansellert i Shopify';save()}
   // Block later out-of-order paid webhooks for a cancelled order.
   db.cancelledIds=db.cancelledIds||[];if(!db.cancelledIds.includes(key)){db.cancelledIds.push(key);save()}
   return json(res,200,{ok:true,cancelled:true});
  }
  if(topic==='refunds/create'){
   // A refund may cover only one item or shipping. Flag for human review, never assume full refund.
   if(existing&&existing.status!=='done'&&existing.status!=='cancelled'){existing.status='review';existing.notes='Refusjon registrert i Shopify – sjekk bestillingen';save()}
   return json(res,200,{ok:true,review:!!existing});
  }
  if(order.cancelled_at||db.cancelledIds?.includes(key))return json(res,200,{ok:true,ignored:'cancelled'});
  if(order.financial_status && !['paid','partially_refunded'].includes(order.financial_status))return json(res,200,{ok:true,ignored:'not paid'});
  if(db.seen.includes(key)||existing)return json(res,200,{ok:true,duplicate:true});
  const products=productsFrom(order);
  if(products.length)db.items.push(item(crypto.randomUUID(),safeStr(order.name||`Bestilling ${key}`,55),products,key));
  db.seen.push(key);save();return json(res,200,{ok:true});
 }
 if(req.method==='POST'&&url.pathname==='/api/login'){
  if(!originOk(req))return json(res,403,{error:'Origin blocked'});const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();const f=loginFails.get(ip)||{count:0,ts:Date.now()};if(f.count>=8&&Date.now()-f.ts<15*60*1000)return json(res,429,{error:'For mange forsøk. Prøv igjen om 15 minutter.'});const body=JSON.parse((await receive(req)).toString('utf8'));if(!eq(body.password||'',ADMIN_PASSWORD)){loginFails.set(ip,{count:f.count+1,ts:Date.now()});return json(res,401,{error:'Feil passord'})}loginFails.delete(ip);
  const expiry=String(Date.now()+12*60*60*1000);return json(res,200,{ok:true},{'Set-Cookie':`kn_session=${expiry}.${hmac(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.COOKIE_SECURE==='true'?'; Secure':''}`});
 }
 if(req.method==='POST'&&url.pathname==='/api/logout'){if(!originOk(req))return json(res,403,{error:'Forbidden'});return json(res,200,{ok:true},{'Set-Cookie':'kn_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(process.env.COOKIE_SECURE==='true'?'; Secure':'')})}
 if(url.pathname.startsWith('/api/admin/')){
  if(!auth(req))return json(res,401,{error:'Logg inn først'});
  if(req.method==='GET'&&url.pathname==='/api/admin/items')return json(res,200,{items:db.items});
  if(req.method!=='POST'||!originOk(req))return json(res,403,{error:'Forbidden'});
  const body=JSON.parse((await receive(req)).toString('utf8'));
  if(url.pathname==='/api/admin/add'){
   const label=safeStr(body.label,55),title=safeStr(body.product,80),quantity=Number(body.quantity);if(!label||!title||!Number.isInteger(quantity)||quantity<1||quantity>100)return json(res,400,{error:'Ugyldig navn, produkt eller antall'});
   db.items.push(item(crypto.randomUUID(),label,[{title,quantity}]));save();return json(res,200,{ok:true});
  }
  if(url.pathname==='/api/admin/update'){
   const index=db.items.findIndex(x=>x.id===body.id);if(index<0)return json(res,404,{error:'Ikke funnet'});
   if(body.label!==undefined){const label=safeStr(body.label,55);if(!label)return json(res,400,{error:'Navnet kan ikke være tomt'});db.items[index].label=label}
   if(body.status!==undefined){if(!validStates.includes(body.status))return json(res,400,{error:'Invalid status'});if(body.status==='opening')db.items.forEach(x=>{if(x.status==='opening')x.status='waiting'});db.items[index].status=body.status}
   save();return json(res,200,{ok:true});
  }
  if(url.pathname==='/api/admin/move'){
   const index=db.items.findIndex(x=>x.id===body.id),delta=Number(body.delta);if(index<0||![1,-1].includes(delta))return json(res,400,{error:'Invalid move'});const next=index+delta;if(next>=0&&next<db.items.length)[db.items[index],db.items[next]]=[db.items[next],db.items[index]];save();return json(res,200,{ok:true});
  }
  return json(res,404,{error:'Not found'});
 }
 return json(res,404,{error:'Not found'});
}catch(e){console.error(e.message);if(!res.headersSent)json(res,e.message==='too large'?413:400,{error:'Could not process request'})}
});server.listen(PORT,HOST,()=>console.log(`KlassikernN Queue: http://${HOST}:${PORT} | Admin: /admin`));
