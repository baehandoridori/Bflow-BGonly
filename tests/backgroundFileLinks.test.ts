import test from 'node:test';
import assert from 'node:assert/strict';
import { appendBackgroundImage, assertBackgroundImageCapacity, backgroundWorkFilePath, disconnectBackgroundImage, prepareBackgroundFileLinks } from '../src/features/backgrounds/fileLinks.ts';
import type { BackgroundView } from '../src/features/backgrounds/types.ts';

const source: BackgroundView = {
  id:'view', revision:4, name:'교실', placeId:'place', cameraPlaceId:null, visiblePlaceIds:[], relatedPlaceIds:[], shot:'wide', tags:[], memo:'',
  variants:[
    {id:'day', name:'낮', time:'day', activeRevisionId:'day-image', revisions:[{id:'day-image',imageUrl:'old-day',filePath:'G:\\교실.psd',sourceImagePath:'G:\\교실.png',createdAt:'2026-09-21T00:00:00Z'}]},
    {id:'night', name:'밤', time:'night', workFilePath:'G:\\교실_밤.psd',activeRevisionId:'night-image',revisions:[{id:'night-image',imageUrl:'old-night',filePath:'',createdAt:'2026-09-21T00:00:00Z'}]},
  ],
};

test('legacy work file survives image revision changes and explicit unlink never revives it',()=>{
  const prepared=prepareBackgroundFileLinks(source);
  assert.equal(prepared.variants[0].workFilePath,'G:\\교실.psd');
  const updated=appendBackgroundImage(prepared,'day',{id:'new-day',imageUrl:'new',filePath:'',sourceImagePath:'G:\\교실_v2.png',createdAt:'2026-09-22T00:00:00Z'});
  assert.equal(backgroundWorkFilePath(updated.variants[0]),'G:\\교실.psd');
  assert.equal(backgroundWorkFilePath({...updated.variants[0],workFilePath:'',activeRevisionId:'day-image'}),'');
  assert.equal(source.variants[0].workFilePath,undefined);
});

test('late image result updates only its captured variant and retains history and work paths',()=>{
  const updated=appendBackgroundImage(source,'day',{id:'new-day',imageUrl:'new',filePath:'',sourceImagePath:'G:\\교실_v2.png',createdAt:'2026-09-22T00:00:00Z'});
  assert.equal(updated.variants[1],source.variants[1]);
  assert.equal(updated.variants[0].revisions.length,2);
  assert.equal(updated.variants[0].activeRevisionId,'new-day');
  assert.equal(updated.variants[0].workFilePath,'G:\\교실.psd');
  assert.equal(source.variants[0].activeRevisionId,'day-image');
});

test('disconnecting an image path preserves preview, revision identity, work path and other variants',()=>{
  const updated=disconnectBackgroundImage(source,'day','day-image');
  assert.deepEqual(updated.variants[0].revisions[0],{...source.variants[0].revisions[0],sourceImagePath:''});
  assert.equal(updated.variants[0].activeRevisionId,'day-image');
  assert.equal(backgroundWorkFilePath(updated.variants[0]),'G:\\교실.psd');
  assert.equal(updated.variants[1],source.variants[1]);
});

test('the hundredth image is accepted but the next is rejected without changing the draft',()=>{
  const draft = structuredClone(source);
  draft.variants[0].revisions = Array.from({length:99}, (_,index)=>({...source.variants[0].revisions[0],id:`revision-${index}`}));
  assert.doesNotThrow(()=>assertBackgroundImageCapacity(draft.variants[0]));
  const image = {...source.variants[0].revisions[0],id:'revision-100'};
  const full = appendBackgroundImage(draft,'day',image);
  assert.equal(full.variants[0].revisions.length,100);
  const before = structuredClone(full);
  assert.throws(()=>assertBackgroundImageCapacity(full.variants[0]),/100개/);
  assert.throws(()=>appendBackgroundImage(full,'day',{...image,id:'revision-101'}),/100개/);
  assert.deepEqual(full,before);
  assert.equal(draft.variants[0].revisions.length,99);
});
