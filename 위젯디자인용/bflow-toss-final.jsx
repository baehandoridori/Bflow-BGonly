import { useState, useRef, useCallback, useEffect, useMemo } from "react";

const ACCENT = "#6C5CE7";
const BG = "#0F1117";
const CARD_GLASS = "rgba(26, 29, 39, 0.55)";
const CARD_GLASS_HOVER = "rgba(30, 33, 48, 0.65)";
const CARD_GLASS_DRAG = "rgba(35, 38, 55, 0.7)";
const BORDER = "rgba(45, 48, 65, 0.5)";
const BORDER_HOVER = "rgba(108, 92, 231, 0.2)";
const TEXT = "#E8E8EE";
const TEXT_DIM = "#8B8DA3";
const STAGES = { LO: "#74B9FF", "완료": "#A29BFE", "검수": "#FDCB6E", PNG: "#00B894" };

const COLS = 24;
const ROW_H = 16;
const GAP = 6;

// ─── 충돌 감지 & 밀어내기 ───
function isOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function resolveCollisions(layout, movedId) {
  let result = layout.map(l => ({ ...l }));
  const moved = result.find(l => l.id === movedId);
  if (!moved) return result;
  let changed = true, safety = 0;
  while (changed && safety < 50) {
    changed = false; safety++;
    for (const item of result) {
      if (item.id === movedId) continue;
      if (isOverlap(moved, item)) {
        item.y = moved.y + moved.h;
        changed = true;
      }
    }
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (isOverlap(result[i], result[j])) {
          const [upper, lower] = result[i].y <= result[j].y ? [result[i], result[j]] : [result[j], result[i]];
          if (lower.id !== movedId) { lower.y = upper.y + upper.h; changed = true; }
        }
      }
    }
  }
  return result;
}

function compactLayout(layout) {
  let result = layout.map(l => ({ ...l }));
  result.sort((a, b) => a.y - b.y);
  for (let i = 0; i < result.length; i++) {
    let ny = 0;
    while (ny < result[i].y) {
      const test = { ...result[i], y: ny };
      if (!result.some((o, j) => j !== i && isOverlap(test, o))) { result[i].y = ny; break; }
      ny++;
    }
  }
  return result;
}

// ─── ㄴㄱ자 Corner Glow ───
function CornerGlow({ corner, visible }) {
  const size = 22, thick = 2.5, len = 15;
  const paths = {
    nw: `M ${thick/2} ${len} L ${thick/2} ${thick/2} L ${len} ${thick/2}`,
    ne: `M ${size-len} ${thick/2} L ${size-thick/2} ${thick/2} L ${size-thick/2} ${len}`,
    sw: `M ${thick/2} ${size-len} L ${thick/2} ${size-thick/2} L ${len} ${size-thick/2}`,
    se: `M ${size-len} ${size-thick/2} L ${size-thick/2} ${size-thick/2} L ${size-thick/2} ${size-len}`,
  };
  const pos = { nw:{top:-2,left:-2}, ne:{top:-2,right:-2}, sw:{bottom:-2,left:-2}, se:{bottom:-2,right:-2} };
  return (
    <svg width={size} height={size} style={{
      position:"absolute",...pos[corner], opacity:visible?1:0,
      transform:`scale(${visible?1:0.6})`, transition:"opacity 0.2s ease, transform 0.2s ease",
      pointerEvents:"none", filter:visible?`drop-shadow(0 0 6px ${ACCENT}80)`:"none",
    }}>
      <path d={paths[corner]} fill="none" stroke={ACCENT}
        strokeWidth={thick} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EdgeLine({ edge, visible }) {
  const styles = {
    n:{top:0,left:"15%",right:"15%",height:2}, s:{bottom:0,left:"15%",right:"15%",height:2},
    w:{left:0,top:"15%",bottom:"15%",width:2}, e:{right:0,top:"15%",bottom:"15%",width:2},
  };
  const isH = edge==="n"||edge==="s";
  return (
    <div style={{
      position:"absolute",...styles[edge], borderRadius:1,
      background:`linear-gradient(${isH?"90deg":"180deg"}, transparent, ${ACCENT} 50%, transparent)`,
      opacity:visible?0.9:0, transform:visible?"scale(1)":(isH?"scaleX(0.4)":"scaleY(0.4)"),
      transition:"opacity 0.2s ease, transform 0.2s ease",
      pointerEvents:"none", boxShadow:visible?`0 0 10px ${ACCENT}40`:"none",
    }} />
  );
}

const CURSOR_MAP = {
  n:"n-resize",s:"s-resize",w:"w-resize",e:"e-resize",
  nw:"nw-resize",ne:"ne-resize",sw:"sw-resize",se:"se-resize",
};

// ─── 위젯 콘텐츠 ───
function Donut({pct,color,size=64}){
  const sw=4.5,r=(size-sw)/2,c=2*Math.PI*r;
  return(
    <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={c} strokeDashoffset={c-(pct/100)*c}
        strokeLinecap="round" style={{transition:"stroke-dashoffset 0.8s ease"}}/>
    </svg>
  );
}

const WC={
  overall:{title:"전체 진행률",icon:"📊",render:()=>(
    <div style={{display:"flex",alignItems:"center",gap:12,height:"100%"}}>
      <div style={{position:"relative",flexShrink:0}}>
        <Donut pct={67} color={ACCENT}/>
        <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center"}}>
          <div style={{fontSize:15,fontWeight:800,color:TEXT}}>67%</div>
          <div style={{fontSize:7,color:TEXT_DIM}}>전체</div>
        </div>
      </div>
      <div>
        <div style={{fontSize:9,color:TEXT_DIM,marginBottom:5}}>EP03 사코팍</div>
        <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
          {Object.entries(STAGES).map(([k,c])=>(
            <span key={k} style={{padding:"2px 5px",borderRadius:3,background:`${c}18`,color:c,fontSize:8,fontWeight:600}}>{k}</span>
          ))}
        </div>
      </div>
    </div>
  )},
  stages:{title:"단계별 진행률",icon:"📈",render:()=>(
    <div>{[["LO",82,STAGES.LO],["완료",65,STAGES["완료"]],["검수",41,STAGES["검수"]],["PNG",28,STAGES.PNG]].map(([l,v,c])=>(
      <div key={l} style={{marginBottom:6}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
          <span style={{fontSize:10,color:TEXT_DIM}}>{l}</span>
          <span style={{fontSize:10,color:c,fontWeight:600}}>{v}%</span>
        </div>
        <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${v}%`,background:c,borderRadius:2,transition:"width 0.6s ease"}}/>
        </div>
      </div>
    ))}</div>
  )},
  assignees:{title:"담당자별 현황",icon:"👥",render:()=>(
    <div>{[["김한솔",18,22,"한"],["이수진",14,20,"수"],["박민재",11,18,"민"],["정다온",9,15,"다"],["최예린",7,16,"예"]].map(([n,d,t,a])=>(
      <div key={n} style={{display:"flex",alignItems:"center",gap:7,padding:"4px 6px",
        background:"rgba(255,255,255,0.03)",borderRadius:5,marginBottom:3}}>
        <div style={{width:22,height:22,borderRadius:"50%",background:`linear-gradient(135deg,${ACCENT}40,${ACCENT})`,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:TEXT}}>{a}</div>
        <div style={{flex:1}}>
          <div style={{fontSize:10,color:TEXT,fontWeight:500}}>{n}</div>
          <div style={{fontSize:7,color:TEXT_DIM}}>{d}/{t}</div>
        </div>
        <div style={{fontSize:10,fontWeight:700,color:Math.round(d/t*100)===100?"#00B894":ACCENT}}>{Math.round(d/t*100)}%</div>
      </div>
    ))}</div>
  )},
  episodes:{title:"에피소드 요약",icon:"🎬",render:()=>(
    <div style={{display:"flex",gap:5,height:"100%"}}>
      {[["EP01",95,"완료"],["EP02",78,"마무리"],["EP03",45,"진행 중"]].map(([ep,pct,st],i)=>(
        <div key={ep} style={{flex:1,padding:"6px 8px",borderRadius:6,
          background:i===2?`${ACCENT}10`:"rgba(255,255,255,0.03)",
          border:`1px solid ${i===2?`${ACCENT}30`:"transparent"}`}}>
          <div style={{fontSize:10,fontWeight:700,color:i===2?ACCENT:TEXT,marginBottom:2}}>{ep}</div>
          <div style={{fontSize:15,fontWeight:800,color:TEXT}}>{pct}%</div>
          <div style={{fontSize:8,color:TEXT_DIM,marginBottom:3}}>{st}</div>
          <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:2,width:`${pct}%`,
              background:pct>=90?"#00B894":pct>=60?ACCENT:STAGES.LO}}/>
          </div>
        </div>
      ))}
    </div>
  )},
  dept:{title:"부서별 비교",icon:"⚡",render:()=>(
    <div style={{display:"flex",gap:14,alignItems:"center",justifyContent:"center",height:"100%"}}>
      {[["BG",67,ACCENT],["ACT",52,"#E17055"]].map(([l,v,c])=>(
        <div key={l} style={{textAlign:"center"}}>
          <div style={{position:"relative",display:"inline-block"}}>
            <Donut pct={v} color={c} size={48}/>
            <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)"}}>
              <div style={{fontSize:11,fontWeight:800,color:TEXT}}>{v}%</div>
            </div>
          </div>
          <div style={{fontSize:8,color:TEXT_DIM,marginTop:3}}>{l}</div>
        </div>
      ))}
    </div>
  )},
};

const INIT=[
  {id:"overall", x:0, y:0, w:10,h:8},
  {id:"stages",  x:10,y:0, w:7, h:8},
  {id:"assignees",x:17,y:0,w:7, h:16},
  {id:"episodes", x:0, y:8,w:10,h:8},
  {id:"dept",     x:10,y:8,w:7, h:8},
];

export default function App(){
  const [layout,setLayout]=useState(INIT);
  const gridRef=useRef(null);

  const [edgeZone,setEdgeZone]=useState({});
  const [hoverWidget,setHoverWidget]=useState(null);
  const [dragId,setDragId]=useState(null);
  const [dragPx,setDragPx]=useState({x:0,y:0});
  const [dragStartInfo,setDragStartInfo]=useState(null);
  const [dragSnapped,setDragSnapped]=useState(null);
  const [resizeId,setResizeId]=useState(null);
  const [resizeEdge,setResizeEdge]=useState(null);
  const [resizePx,setResizePx]=useState(null);
  const [resizeStart,setResizeStart]=useState(null);
  const [resizeSnapped,setResizeSnapped]=useState(null);
  const [settling,setSettling]=useState(null);

  const getCellSize=useCallback(()=>{
    if(!gridRef.current) return{cw:40,ch:ROW_H};
    const r=gridRef.current.getBoundingClientRect();
    return{cw:(r.width-GAP*(COLS-1))/COLS,ch:ROW_H};
  },[]);

  const toPixels=useCallback((item)=>{
    const{cw,ch}=getCellSize();
    return{
      left:item.x*(cw+GAP),top:item.y*(ch+GAP),
      width:item.w*cw+(item.w-1)*GAP,height:item.h*ch+(item.h-1)*GAP,
    };
  },[getCellSize]);

  const snapToGrid=useCallback((px,py,pw,ph)=>{
    const{cw,ch}=getCellSize();
    return{
      x:Math.max(0,Math.min(COLS-1,Math.round(px/(cw+GAP)))),
      y:Math.max(0,Math.round(py/(ch+GAP))),
      w:Math.min(COLS,Math.max(3,Math.round((pw+GAP)/(cw+GAP)))),
      h:Math.max(3,Math.round((ph+GAP)/(ch+GAP))),
    };
  },[getCellSize]);

  // ─── 실시간 미리보기 레이아웃 계산 ───
  const previewLayout = useMemo(()=>{
    if(dragId && dragSnapped){
      let next = layout.map(l=>l.id===dragId?{...l,x:dragSnapped.x,y:dragSnapped.y}:l);
      next = resolveCollisions(next,dragId);
      next = compactLayout(next);
      return next;
    }
    if(resizeId && resizeSnapped){
      let next = layout.map(l=>l.id===resizeId?{...l,...resizeSnapped}:l);
      next = resolveCollisions(next,resizeId);
      next = compactLayout(next);
      return next;
    }
    return null;
  },[layout,dragId,dragSnapped,resizeId,resizeSnapped]);

  // 표시용 레이아웃: 드래그/리사이즈 중이면 preview, 아니면 실제
  const displayLayout = previewLayout || layout;

  // ─── 드래그 ───
  const startDrag=(e,item)=>{
    e.preventDefault();
    const pos=toPixels(item);
    setDragId(item.id);
    setDragStartInfo({mx:e.clientX,my:e.clientY,origLeft:pos.left,origTop:pos.top,item});
    setDragPx({x:0,y:0}); setDragSnapped(null);
  };

  useEffect(()=>{
    if(!dragId||!dragStartInfo) return;
    const mm=(e)=>{
      const dx=e.clientX-dragStartInfo.mx, dy=e.clientY-dragStartInfo.my;
      setDragPx({x:dx,y:dy});
      const nL=dragStartInfo.origLeft+dx, nT=dragStartInfo.origTop+dy;
      const origPos=toPixels(dragStartInfo.item);
      setDragSnapped(snapToGrid(nL,nT,origPos.width,origPos.height));
    };
    const mu=()=>{
      if(previewLayout){
        setLayout(previewLayout);
      }
      setSettling(dragId); setTimeout(()=>setSettling(null),450);
      setDragId(null);setDragStartInfo(null);setDragPx({x:0,y:0});setDragSnapped(null);
    };
    window.addEventListener("mousemove",mm);
    window.addEventListener("mouseup",mu);
    document.body.style.cursor="grabbing";
    document.body.style.userSelect="none";
    return()=>{window.removeEventListener("mousemove",mm);window.removeEventListener("mouseup",mu);
      document.body.style.cursor="";document.body.style.userSelect="";};
  },[dragId,dragStartInfo,toPixels,snapToGrid,previewLayout]);

  // ─── 리사이즈 ───
  const startResize=(e,item,edge)=>{
    e.preventDefault();e.stopPropagation();
    const pos=toPixels(item);
    setResizeId(item.id);setResizeEdge(edge);
    setResizeStart({mx:e.clientX,my:e.clientY,...pos,item});
    setResizePx({...pos});setResizeSnapped(null);
  };

  useEffect(()=>{
    if(!resizeId||!resizeStart||!resizeEdge) return;
    const mm=(e)=>{
      const dx=e.clientX-resizeStart.mx, dy=e.clientY-resizeStart.my;
      let{left,top,width,height}=resizeStart;
      if(resizeEdge.includes("e")) width=Math.max(80,resizeStart.width+dx);
      if(resizeEdge.includes("w")){left=resizeStart.left+dx;width=Math.max(80,resizeStart.width-dx);}
      if(resizeEdge.includes("s")) height=Math.max(50,resizeStart.height+dy);
      if(resizeEdge.includes("n")){top=resizeStart.top+dy;height=Math.max(50,resizeStart.height-dy);}
      setResizePx({left,top,width,height});
      setResizeSnapped(snapToGrid(left,top,width,height));
    };
    const mu=()=>{
      if(previewLayout) setLayout(previewLayout);
      setSettling(resizeId);setTimeout(()=>setSettling(null),450);
      setResizeId(null);setResizeEdge(null);setResizeStart(null);setResizePx(null);setResizeSnapped(null);
    };
    window.addEventListener("mousemove",mm);window.addEventListener("mouseup",mu);
    document.body.style.cursor=CURSOR_MAP[resizeEdge]||"default";
    document.body.style.userSelect="none";
    return()=>{window.removeEventListener("mousemove",mm);window.removeEventListener("mouseup",mu);
      document.body.style.cursor="";document.body.style.userSelect="";};
  },[resizeId,resizeEdge,resizeStart,resizePx,snapToGrid,previewLayout]);

  const isActive=dragId!==null||resizeId!==null;

  return(
    <div style={{background:BG,height:"100vh",display:"flex",flexDirection:"column",
      fontFamily:"'Inter',-apple-system,sans-serif",overflow:"hidden",userSelect:"none",position:"relative"}}>

      {/* ── 배경 장식 (글래스모피즘이 비칠 대상) ── */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0}}>
        <div style={{position:"absolute",top:"-20%",left:"-10%",width:"50%",height:"60%",
          background:`radial-gradient(ellipse, ${ACCENT}12, transparent 70%)`,filter:"blur(60px)"}}/>
        <div style={{position:"absolute",bottom:"-15%",right:"-5%",width:"45%",height:"50%",
          background:"radial-gradient(ellipse, #E1705512, transparent 70%)",filter:"blur(60px)"}}/>
        <div style={{position:"absolute",top:"30%",left:"40%",width:"30%",height:"40%",
          background:"radial-gradient(ellipse, #74B9FF08, transparent 70%)",filter:"blur(50px)"}}/>
      </div>

      {/* Header */}
      <div style={{padding:"10px 16px",display:"flex",alignItems:"center",gap:10,flexShrink:0,zIndex:2,position:"relative"}}>
        <div style={{width:26,height:26,borderRadius:6,background:`linear-gradient(135deg,${ACCENT},#8B5CF6)`,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"white"}}>B</div>
        <div style={{flex:1}}>
          <h1 style={{margin:0,fontSize:14,fontWeight:700,color:TEXT}}>B flow Dashboard</h1>
          <p style={{margin:0,fontSize:10,color:TEXT_DIM}}>
            실시간 충돌 해결 · 글래스모피즘 · ㄴㄱ glow
          </p>
        </div>
        <button onClick={()=>{setLayout(INIT);}}
          style={{padding:"5px 10px",borderRadius:5,
            border:`1px solid rgba(255,255,255,0.1)`,
            background:"rgba(255,255,255,0.05)",backdropFilter:"blur(10px)",
            color:TEXT_DIM,fontSize:10,cursor:"pointer"}}>초기화</button>
      </div>

      {/* Grid */}
      <div ref={gridRef} style={{flex:1,position:"relative",margin:"0 10px 8px",minHeight:0,zIndex:1}}>

        {/* ── placeholder (드래그/리사이즈 목표) ── */}
        {dragSnapped && dragId && (()=>{
          const item = layout.find(l=>l.id===dragId);
          if(!item) return null;
          const pp = toPixels({...item, x:dragSnapped.x, y:dragSnapped.y});
          return <div style={{position:"absolute",...pp,borderRadius:12,
            border:`2px dashed ${ACCENT}35`,background:`${ACCENT}05`,
            transition:"all 0.25s cubic-bezier(0.16,1,0.3,1)",
            pointerEvents:"none",zIndex:0}}/>;
        })()}

        {resizeSnapped && resizeId && (()=>{
          const pp = toPixels(resizeSnapped);
          return <div style={{position:"absolute",...pp,borderRadius:12,
            border:`2px dashed ${ACCENT}35`,background:`${ACCENT}05`,
            transition:"all 0.25s cubic-bezier(0.16,1,0.3,1)",
            pointerEvents:"none",zIndex:0}}/>;
        })()}

        {/* ── 위젯들 ── */}
        {displayLayout.map(item=>{
          const wc=WC[item.id]; if(!wc) return null;
          const isDrag=dragId===item.id;
          const isRes=resizeId===item.id;
          const isSett=settling===item.id;
          const zone=edgeZone[item.id];
          const isHov=hoverWidget===item.id;
          const dimmed=isActive&&!isDrag&&!isRes;

          // 위치 결정
          let pos;
          if(isDrag){
            // 드래그 중인 위젯: 원본 그리드 위치 + 마우스 픽셀 오프셋
            const origItem = layout.find(l=>l.id===item.id);
            const orig = toPixels(origItem);
            pos={...orig,left:orig.left+dragPx.x,top:orig.top+dragPx.y};
          } else if(isRes && resizePx){
            pos=resizePx;
          } else {
            // 다른 위젯들: displayLayout(=previewLayout) 기준 → 실시간 밀려남!
            pos=toPixels(item);
          }

          let borderColor=BORDER;
          let boxShadow="0 2px 8px rgba(0,0,0,0.2)";
          let bg=CARD_GLASS;
          let opacity=1;
          let zIndex=1;
          // 핵심: 비드래그 위젯은 항상 부드러운 transition (실시간 밀림!)
          let transition="left 0.35s cubic-bezier(0.16,1,0.3,1), top 0.35s cubic-bezier(0.16,1,0.3,1), width 0.35s cubic-bezier(0.16,1,0.3,1), height 0.35s cubic-bezier(0.16,1,0.3,1), box-shadow 0.2s ease, opacity 0.2s ease, border-color 0.2s ease, background 0.2s ease, transform 0.2s ease";

          if(isHov&&!isDrag&&!isRes){
            bg=CARD_GLASS_HOVER;
            borderColor=BORDER_HOVER;
            boxShadow="0 4px 16px rgba(0,0,0,0.25), 0 0 0 0.5px rgba(108,92,231,0.15)";
          }

          if(zone&&!isDrag&&!isRes){
            borderColor="rgba(108,92,231,0.25)";
          }

          if(isDrag){
            bg=CARD_GLASS_DRAG;
            borderColor="rgba(108,92,231,0.5)";
            boxShadow=`0 20px 60px rgba(0,0,0,0.5), 0 0 0 1.5px rgba(108,92,231,0.4)`;
            zIndex=100; opacity=0.95;
            transition="box-shadow 0.15s ease, opacity 0.1s ease, border-color 0.1s ease, background 0.1s ease";
          }

          if(isRes){
            borderColor="rgba(108,92,231,0.45)";
            boxShadow=`0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(108,92,231,0.3)`;
            transition="box-shadow 0.15s ease, border-color 0.15s ease";
          }

          if(isSett) transition="all 0.45s cubic-bezier(0.34,1.56,0.64,1)";
          if(dimmed) opacity=0.3;

          const activeEdges=zone?({n:["n"],s:["s"],w:["w"],e:["e"],nw:["n","w"],ne:["n","e"],sw:["s","w"],se:["s","e"]}[zone]||[]):[];
          const activeCorners=zone?({nw:["nw"],ne:["ne"],sw:["sw"],se:["se"]}[zone]||[]):[];

          return(
            <div key={item.id}
              onMouseEnter={()=>setHoverWidget(item.id)}
              onMouseLeave={()=>{setHoverWidget(null);setEdgeZone(p=>({...p,[item.id]:null}));}}
              style={{
                position:"absolute",left:pos.left,top:pos.top,width:pos.width,height:pos.height,
                // ✨ 글래스모피즘 핵심
                background:bg,
                backdropFilter:"blur(20px) saturate(1.3)",
                WebkitBackdropFilter:"blur(20px) saturate(1.3)",
                border:`1px solid ${borderColor}`,
                borderRadius:12,overflow:"visible",transition,zIndex,opacity,boxShadow,
                display:"flex",flexDirection:"column",
              }}>

              {/* 글래스 빛 반사 (상단 하이라이트) */}
              <div style={{
                position:"absolute",top:0,left:0,right:0,height:"40%",borderRadius:"12px 12px 0 0",
                background:"linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)",
                pointerEvents:"none",
              }}/>

              {/* 노이즈 텍스처 오버레이 */}
              <div style={{
                position:"absolute",inset:0,borderRadius:12,
                opacity:0.03,
                backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
                backgroundSize:"128px 128px",
                pointerEvents:"none",
              }}/>

              {/* Header = drag handle */}
              <div onMouseDown={(e)=>startDrag(e,item)}
                style={{padding:"8px 12px 6px",display:"flex",alignItems:"center",gap:5,
                  borderBottom:`1px solid rgba(255,255,255,0.06)`,flexShrink:0,
                  cursor:isDrag?"grabbing":"grab",borderRadius:"12px 12px 0 0",
                  background:isDrag?"rgba(108,92,231,0.08)":"transparent",
                  transition:"background 0.15s ease",position:"relative",zIndex:2}}>
                <svg width="8" height="10" viewBox="0 0 8 10" style={{opacity:0.25,flexShrink:0}}>
                  <circle cx="2" cy="2" r="1" fill={TEXT_DIM}/><circle cx="6" cy="2" r="1" fill={TEXT_DIM}/>
                  <circle cx="2" cy="5" r="1" fill={TEXT_DIM}/><circle cx="6" cy="5" r="1" fill={TEXT_DIM}/>
                  <circle cx="2" cy="8" r="1" fill={TEXT_DIM}/><circle cx="6" cy="8" r="1" fill={TEXT_DIM}/>
                </svg>
                <span style={{fontSize:12,opacity:0.7}}>{wc.icon}</span>
                <span style={{fontSize:11,fontWeight:600,color:TEXT,letterSpacing:"-0.01em"}}>{wc.title}</span>
              </div>

              <div style={{padding:"8px 12px 10px",flex:1,overflow:"hidden",minHeight:0,
                borderRadius:"0 0 12px 12px",position:"relative",zIndex:2}}>
                {wc.render()}
              </div>

              {/* Resize hit areas */}
              {!isDrag&&!isActive&&(
                <>
                  {[
                    {edge:"n",style:{top:0,left:16,right:16,height:10,cursor:"n-resize"}},
                    {edge:"s",style:{bottom:0,left:16,right:16,height:10,cursor:"s-resize"}},
                    {edge:"w",style:{left:0,top:16,bottom:16,width:10,cursor:"w-resize"}},
                    {edge:"e",style:{right:0,top:16,bottom:16,width:10,cursor:"e-resize"}},
                    {edge:"nw",style:{top:0,left:0,width:16,height:16,cursor:"nw-resize"}},
                    {edge:"ne",style:{top:0,right:0,width:16,height:16,cursor:"ne-resize"}},
                    {edge:"sw",style:{bottom:0,left:0,width:16,height:16,cursor:"sw-resize"}},
                    {edge:"se",style:{bottom:0,right:0,width:16,height:16,cursor:"se-resize"}},
                  ].map(({edge:en,style:s})=>(
                    <div key={en}
                      onMouseEnter={()=>setEdgeZone(p=>({...p,[item.id]:en}))}
                      onMouseLeave={()=>setEdgeZone(p=>({...p,[item.id]:null}))}
                      onMouseDown={(e)=>startResize(e,item,en)}
                      style={{position:"absolute",...s,zIndex:20}}/>
                  ))}
                </>
              )}

              {["nw","ne","sw","se"].map(c=>(<CornerGlow key={c} corner={c} visible={activeCorners.includes(c)}/>))}
              {["n","s","w","e"].map(ed=>(<EdgeLine key={ed} edge={ed} visible={activeEdges.includes(ed)}/>))}

              {isDrag&&(<div style={{position:"absolute",inset:-1,borderRadius:13,pointerEvents:"none",
                border:`1.5px solid ${ACCENT}50`,
                boxShadow:`0 0 20px ${ACCENT}20, inset 0 0 20px ${ACCENT}06`,
                animation:"glowPulse 1.5s ease-in-out infinite"}}/>)}

              {dimmed&&(<div style={{position:"absolute",inset:0,borderRadius:12,
                background:"rgba(15,17,23,0.5)",backdropFilter:"blur(2px)",
                pointerEvents:"none",transition:"opacity 0.25s ease"}}/>)}

              {isSett&&(<div style={{position:"absolute",inset:-1,borderRadius:13,pointerEvents:"none",
                border:`1.5px solid ${ACCENT}45`,animation:"settleFlash 0.45s ease-out forwards"}}/>)}
            </div>
          );
        })}
      </div>

      {/* Bottom bar */}
      <div style={{padding:"7px 16px",borderTop:"1px solid rgba(255,255,255,0.06)",flexShrink:0,
        display:"flex",alignItems:"center",gap:10,zIndex:2,position:"relative",
        background:"rgba(26,29,39,0.6)",backdropFilter:"blur(16px)"}}>
        <div style={{flex:1,display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:8,color:"#00B894",padding:"2px 6px",background:"#00B89410",borderRadius:3}}>실시간 충돌 해결 ✓</span>
          <span style={{fontSize:8,color:TEXT_DIM,padding:"2px 6px",background:"rgba(255,255,255,0.04)",borderRadius:3}}>모서리=리사이즈</span>
          <span style={{fontSize:8,color:ACCENT,padding:"2px 6px",background:`${ACCENT}10`,borderRadius:3}}>헤더=드래그</span>
        </div>
      </div>

      <style>{`
        @keyframes settleFlash{0%{opacity:0.7}100%{opacity:0}}
        @keyframes glowPulse{0%,100%{opacity:0.6}50%{opacity:1}}
        *{box-sizing:border-box;margin:0;padding:0;}
      `}</style>
    </div>
  );
}
