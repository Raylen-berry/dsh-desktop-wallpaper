// Project metadata is data: never evaluate its conditions, scripts or HTML.
const BASIC = [
  {key:'volume',type:'slider',text:'音量',value:0,min:0,max:100,step:1,group:'播放与交互'},
  {key:'rate',type:'slider',text:'播放速度（倍）',value:1,min:0.1,max:2,step:0.05,group:'播放与交互'},
  {key:'cameraparallax',type:'bool',text:'鼠标视差',value:true,group:'播放与交互'},
  {key:'alignmentfliph',type:'bool',text:'水平翻转',value:false,group:'播放与交互'},
];
function schema(project) {
  const result=BASIC.map(p=>({...p}));let group='壁纸自定义';
  const properties=project?.general?.properties || {};
  for(const [key,p] of Object.entries(properties).slice(0,200).sort((a,b)=>(Number(a[1]?.order)||0)-(Number(b[1]?.order)||0))) {
    if(!p || !/^[a-zA-Z0-9_]{1,80}$/.test(key) || BASIC.some(x=>x.key===key))continue;
    const text=String(key==='schemecolor'?'主题配色':p.text||key).slice(0,120);
    if(p.type==='group'){group=text;continue;}
    const field={key,type:p.type,text,group:key==='schemecolor'?'播放与交互':group,value:p.value};
    if(p.type==='slider'){
      if(!Number.isFinite(p.min)||!Number.isFinite(p.max)||p.max<=p.min)continue;
      Object.assign(field,{min:p.min,max:p.max,step:Number.isFinite(p.step)&&p.step>0?p.step:(p.max-p.min)/100});
    } else if(p.type==='combo') {
      field.options=(Array.isArray(p.options)?p.options:[]).slice(0,50).filter(o=>o&&['string','number'].includes(typeof o.value)).map(o=>({label:String(o.label||o.value).slice(0,100),value:o.value}));
      if(!field.options.length)continue;
    } else if(!['bool','color','textinput'].includes(p.type)) {
      field.type='unsupported';field.value=null;field.note='此项需在 Wallpaper Engine 中设置';
    }
    result.push(field);
  }
  return result;
}
function validate(fields,patch) {
  if(!patch || typeof patch!=='object' || Array.isArray(patch) || Object.keys(patch).length>220)throw Error('属性格式无效');
  const out=Object.create(null),byKey=new Map(fields.map(p=>[p.key,p]));
  for(const [key,value] of Object.entries(patch)){
    const p=byKey.get(key);if(!p || p.type==='unsupported')throw Error('不支持的属性：'+key);
    if(p.type==='bool' && typeof value==='boolean')out[key]=value;
    else if(p.type==='slider' && Number.isFinite(value) && value>=p.min && value<=p.max)out[key]=value;
    else if(p.type==='combo' && p.options.some(o=>o.value===value))out[key]=value;
    else if(p.type==='color' && typeof value==='string'){
      const rgb=value.trim().split(/\s+/).map(Number);
      if(rgb.length!==3 || rgb.some(n=>!Number.isFinite(n)||n<0||n>1))throw Error('颜色无效');
      out[key]=rgb.map(n=>Number(n.toFixed(5))).join(' ');
    } else if(p.type==='textinput' && typeof value==='string' && value.length<=200 && !value.includes(')~END'))out[key]=value;
    else throw Error('属性值无效：'+p.text);
  }
  return out;
}
function defaults(fields){const out=Object.create(null);for(const p of fields){if(p.type==='unsupported')continue;try{Object.assign(out,validate(fields,{[p.key]:p.value}))}catch{}}return out;}
function restore(fields,saved){const out=defaults(fields);for(const [key,value] of Object.entries(saved||{})){try{Object.assign(out,validate(fields,{[key]:value}))}catch{}}return out;}
function command(title,values){if(!/^DSH-WE-\d+-[a-f0-9]{16}$/.test(title))throw Error('无效场景窗口');const json=JSON.stringify(values);if(json.length>16000||json.includes(')~END'))throw Error('属性内容过长或包含控制分隔符');return ['-control','applyProperties','-location',title,'-properties','RAW~('+json+')~END'];}
module.exports={schema,validate,defaults,restore,command};
