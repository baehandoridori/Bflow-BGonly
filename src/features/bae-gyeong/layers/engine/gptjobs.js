/* BAE layer engine: what is asked of GPT (the prototype's wording, rounds 3-5). The PD (a GPT text model) names and
   boxes the props and says who stands in front; GPT Image draws the empty background and the 'front removed' pictures.
   Every image instruction is built from the PD's own answer with fixed sentence patterns (no hand-written text). */

export function inventoryPrompt(pw, ph, notes) {
  return `Image A is a finished background illustration for an animated show, exactly ${pw} x ${ph} pixels.
An animator wants it split into layers: one empty background plus every prop on its own layer, grouped the way an artist would note them.

Props are things placed in the scene that could be moved, hidden or recolored on their own: furniture, vehicles, signs, standing poles and lamps, traffic lights, fences and railings, bins, bags, boxes, cushions and bedding, statues, plants in pots, things hung on walls (boards, frames, clocks, mirrors), and small items.
Not props: the room or building itself (walls, floor, ceiling, built-in doors, windows and stairs), the sky, mountains, distant buildings, the road and sidewalk surface, and trees or bushes growing in the ground.
` + (notes && notes.trim() ? `\nThe artist's notes for this picture (Korean; they may name props and say how to group them; follow them for the groups and the names):\n${notes.trim()}\n` : '') + `
Return:
1. groups: similar props share one group. For each group: group = a short Korean noun (e.g. 의자); en = a short English phrase naming all of them (e.g. "the maroon school chairs"); see_through = true if the background shows through gaps in these props (chairs or desks with open legs, railings, fences, scaffolding, ladders), else false.
2. objects: every single prop, one entry each, small ones too. For each: group = one of the group names; name = a short Korean layer name that tells it apart (e.g. 앞줄 의자 2, 파란 방수포); en = an English phrase that tells it apart by color and position (e.g. "the maroon chair in the front row, second from the left"); box = a tight bounding box around its whole visible part in Image A pixel coordinates [x0, y0, x1, y1].
3. background_en: one English sentence naming what stays as the background (e.g. "the green walls, the wooden floor, the windows and the curtains").
Return only JSON.`;
}
export const INVENTORY_SCHEMA = { type: 'object', additionalProperties: false, required: ['background_en', 'groups', 'objects'], properties: {
  background_en: { type: 'string' },
  groups: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['group', 'en', 'see_through'], properties: { group: { type: 'string' }, en: { type: 'string' }, see_through: { type: 'boolean' } } } },
  objects: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['group', 'name', 'en', 'box'], properties: { group: { type: 'string' }, name: { type: 'string' }, en: { type: 'string' }, box: { type: 'array', items: { type: 'number' } } } } } } };

export function platePrompt(inv) {
  return 'Edit this picture: remove these objects completely and redraw what was behind them.\n' +
    'Remove: ' + inv.groups.map(g => g.en).join('; ') + '.\n' +
    'Where they were, continue the scene that was behind them in the same flat hand-drawn style: ' + inv.background_en + '.\n' +
    'Keep everything else exactly as it is: same composition, same size, same positions, same shapes, same colors, same drawing style. Do not add anything new. No people, no text.';
}
export const plateMaskedPrompt = (p) => p.replace(/\s+$/, '') + ' Only change the masked areas.';

export const DEPTH_SCHEMA = { type: 'object', additionalProperties: false, required: ['pairs'], properties: { pairs: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['a', 'b', 'front'], properties: { a: { type: 'integer' }, b: { type: 'integer' }, front: { type: 'integer' } } } } } };
export function depthPrompt(objs, pairs, pw, ph) {
  const ids = [...new Set(pairs.flat())].sort((a, b) => a - b);
  return `Image A is a finished background illustration, ${pw} x ${ph} pixels. Image B is the same picture with some props outlined and numbered.\n` +
    'Below are pairs of props that touch or overlap. For each pair decide which one is in front: nearer to the viewer, drawn over the other where they meet. ' +
    'Something placed on, hung on or pinned to another thing is in front of it. If they only touch side by side and neither covers the other, answer 0.\n\n' +
    'Props:\n' + ids.map(i => `#${i}: ${objs[i].name} - ${objs[i].en}`).join('\n') + '\n\nPairs (a & b):\n' + pairs.map(([a, b]) => `${a} & ${b}`).join('\n') +
    '\n\nReturn JSON: pairs = one entry for every pair above, in the same order, with a, b and front (= a, b or 0).';
}

export const REVIEW_SCHEMA = { type: 'object', additionalProperties: false, required: ['changes'], properties: { changes: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['what', 'how'], properties: { what: { type: 'string' }, how: { type: 'string' } } } } } };
export function reviewPrompt(inv, pw, ph) {
  return `Image A is the original background illustration, ${pw} x ${ph} pixels. Image B is a copy in which only these props should have been removed: ` + inv.groups.map(g => g.en).join('; ') + '.\n' +
    'Everything else in Image B should look exactly like Image A. Compare the two pictures and list every thing, other than those removed props, that looks different in Image B: ' +
    'changed colors, missing or added things, changed shapes or patterns. For each give: what = a short English phrase naming the thing as it looks in Image A, with its color and place ' +
    '(e.g. "the red-brown painted sidewalk in front of the crossing"); how = a few words on how it changed. Return only JSON.';
}
export function plateFixPrompt(base, review) {
  return (review && review.changes && review.changes.length) ? base + '\nKeep these exactly as they look in the original picture, same colors and shapes (do not recolor, redraw or remove them): ' + review.changes.map(c => c.what).join('; ') + '.' : base;
}

/* ---- v0.4.4: the layer plan (OL in front of the characters, ML behind them, UL the far view) ----
   The same inventory as above, plus what the plan screen needs: where each prop probably goes (OL or ML), the bigger
   prop a small one sits on (merged into it by default), and the far view (UL). The artist checks and changes all of it. */
export function inventoryPrompt2(pw, ph, notes) {
  return inventoryPrompt(pw, ph, notes).replace(/\nReturn only JSON\.\s*$/, '') + `
4. For each object also: layer = "OL" if it stands in the foreground, in front of where the characters would stand and act, so it would hide part of a character (props at the very bottom of the picture or cut off by its bottom edge, the front row of desks and chairs, a plant right at the front); else "ML". Most props are ML.
   on = the name, exactly as you wrote it in objects, of the bigger prop it sits on, hangs on, is pinned to or stands inside (a card on the bulletin board, a book on the shelf, a cushion on the sofa, papers on a desk); else "".
5. far: the far view beyond the room or the street, seen through windows and doors or above the buildings: sky, distant buildings, mountains, trees far away. One entry per separate area (each window's view is its own entry). For each: name = a short Korean name (e.g. 창밖 풍경, 하늘); en = an English phrase; box = a tight box around the visible part of the view only, inside the window frame. An empty list if there is none.
Return only JSON.`;
}
export const INVENTORY_SCHEMA2 = { type: 'object', additionalProperties: false, required: ['background_en', 'groups', 'objects', 'far'], properties: {
  background_en: { type: 'string' },
  groups: INVENTORY_SCHEMA.properties.groups,
  objects: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['group', 'name', 'en', 'box', 'layer', 'on'], properties: {
    group: { type: 'string' }, name: { type: 'string' }, en: { type: 'string' }, box: { type: 'array', items: { type: 'number' } }, layer: { type: 'string', enum: ['OL', 'ML'] }, on: { type: 'string' } } } },
  far: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'en', 'box'], properties: { name: { type: 'string' }, en: { type: 'string' }, box: { type: 'array', items: { type: 'number' } } } } } } };

/* a prop the artist boxed on the plan screen (the PD missed it): the PD names it so GPT can take it away */
export function describePrompt(pw, ph, box, nameKo) {
  return `Image A is a finished background illustration for an animated show, exactly ${pw} x ${ph} pixels. The artist drew a box around one prop: [${box.map(v => Math.round(v)).join(', ')}] in Image A pixel coordinates [x0, y0, x1, y1]` +
    (nameKo && nameKo.trim() ? `, and named it "${nameKo.trim()}" (Korean)` : '') + `.
Return: name = a short Korean layer name for that prop` + (nameKo && nameKo.trim() ? ' (use the artist\'s name)' : '') + `; group = a short Korean noun for its kind; en = an English phrase that tells it apart by color and position (e.g. "the white floor-standing air conditioner on the right"); see_through = true if the background shows through gaps in it (open legs, railings, fences), else false.
Return only JSON.`;
}
export const DESCRIBE_SCHEMA = { type: 'object', additionalProperties: false, required: ['name', 'group', 'en', 'see_through'], properties: { name: { type: 'string' }, group: { type: 'string' }, en: { type: 'string' }, see_through: { type: 'boolean' } } };

/* props added after the empty background was drawn: only their places are drawn again, on top of that empty background */
export function plateAddPrompt(objs) {
  return 'Edit this picture: remove these objects completely and redraw what was behind them.\n' +
    'Remove: ' + objs.map(o => o.en).join('; ') + '.\n' +
    'Where they were, continue the scene that was behind them in the same flat hand-drawn style.\n' +
    'Keep everything else exactly as it is: same composition, same size, same positions, same shapes, same colors, same drawing style. Do not add anything new. No people, no text. Only change the masked areas.';
}
