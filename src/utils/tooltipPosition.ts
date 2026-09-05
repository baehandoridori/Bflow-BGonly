/** A center/bottom anchor for tooltips using translate(-50%, -100%). */
export function cursorTooltipAnchor(point:{x:number;y:number},size:{width:number;height:number},viewport:{width:number;height:number}) {
  const padding=8;
  const width=Math.min(size.width,Math.max(0,viewport.width-padding*2));
  const height=Math.min(size.height,Math.max(0,viewport.height-padding*2));
  const below=point.y-height-12<padding;
  return {
    left:Math.max(padding+width/2,Math.min(point.x,viewport.width-padding-width/2)),
    top:Math.max(padding+height,Math.min(below?point.y+16+height:point.y-12,viewport.height-padding)),
  };
}
