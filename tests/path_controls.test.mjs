import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPathRecipe } from '../scripts/path_schema.js';
import { evaluatePathRecipe, buildPathRecipeComponents } from '../scripts/path_store.js';
import { pathCubics, pathOptions } from '../scripts/path_geometry.js';
import { changePathOptions, changePathClosure, nextPathSeed, insertPathWaypoint, nearestPathSegment,
	changePathPointMode, pathWaypointHandles } from '../scripts/path_draft.js';
import { readPathPresets, savePathPreset, deletePathPreset, pathPresetPatch, validatePathPresets,
	registerPathPresetSetting, MAX_PATH_PRESETS } from '../scripts/path_presets.js';

const points = [{x:0,y:0},{x:300,y:0},{x:300,y:200},{x:0,y:200}];
const near = (a,b,tolerance=1e-6) => assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<tolerance);
let presets, registration;
beforeEach(()=>{
	presets={version:1,presets:null};
	globalThis.game={i18n:{localize:key=>key},settings:{get:()=>structuredClone(presets),set:async(ns,key,data)=>{presets=structuredClone(data);},
		register:(ns,key,options)=>{registration=options;}}};
	globalThis.foundry={utils:{randomID:()=>`preset${(presets.presets?.length ?? 4)+1}`}};
	globalThis.Hooks={callAll:()=>{}};
});

test('closed automatic curves share seam direction, anchored meander and exactly closed rails for all styles',()=>{
	for(const style of ['plain','railway','road','river'])for(const meander of [0,0.2]){
		const recipe=changePathClosure(createPathRecipe(points,{style,meander,seed:42,spacing:1}),true);
		const route=evaluatePathRecipe(recipe);
		assert.deepEqual(route.points[0],route.points.at(-1));
		for(const p of points) assert.ok(route.points.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<1e-8));
		const cubics=pathCubics(recipe.waypoints,recipe.options,true),first=cubics[0],last=cubics.at(-1);
		const a={x:first[1].x-first[0].x,y:first[1].y-first[0].y},b={x:last[3].x-last[2].x,y:last[3].y-last[2].y};
		assert.ok(Math.abs(a.x*b.y-a.y*b.x)<1e-8);assert.ok(a.x*b.x+a.y*b.y>0);
		const components=buildPathRecipeComponents(recipe);
		for(const part of components.filter(p=>p.role!=='sleeper')){
			const values=part.data.shape.points;
			assert.deepEqual(values.slice(0,2),values.slice(-2));
			assert.equal(part.data.fillType,0);assert.equal(part.data.fillAlpha,0);
		}
		if(style==='railway'){
			const sleepers=components.filter(p=>p.role==='sleeper');
			assert.equal(sleepers.length,Math.ceil(route.length/100));
			const centers=sleepers.map(({data})=>({x:data.x+(data.shape.points[0]+data.shape.points[2])/2,
				y:data.y+(data.shape.points[1]+data.shape.points[3])/2}));
			assert.equal(new Set(centers.map(p=>`${p.x.toFixed(6)},${p.y.toFixed(6)}`)).size,centers.length);
			assert.ok(Math.hypot(centers[0].x-centers.at(-1).x,centers[0].y-centers.at(-1).y)>1);
		}
		assert.deepEqual(evaluatePathRecipe(recipe),route);
	}
});

test('closed straight railway distributes sleepers evenly including seam; acute/reversing seams stay finite',()=>{
	const recipe=changePathClosure(createPathRecipe(points,{style:'railway',curve:'straight',spacing:1}),true);
	const sleepers=buildPathRecipeComponents(recipe).filter(p=>p.role==='sleeper');
	assert.equal(sleepers.length,10);
	const distances=sleepers.map(({data})=>{
		const x=data.x+(data.shape.points[0]+data.shape.points[2])/2,y=data.y+(data.shape.points[1]+data.shape.points[3])/2;
		return y===0?x:x===300?300+y:y===200?800-x:1000-y;
	});
	assert.deepEqual(distances,[0,100,200,300,400,500,600,700,800,900]);
	for(const waypoints of [[{x:0,y:0},{x:200,y:0},{x:1,y:1}],[{x:0,y:0},{x:100,y:0},{x:50,y:0}]]){
		const loop=changePathClosure(createPathRecipe(waypoints,{style:'railway',spacing:1}),true);
		assert.ok(buildPathRecipeComponents(loop).every(({data})=>data.shape.points.every(Number.isFinite)));
	}
});

test('closed seam insertion and Smooth conversion preserve valid closing handles and meander intervals',()=>{
	let recipe=changePathClosure(createPathRecipe(points,{style:'plain'}),true);
	const handles=pathWaypointHandles(recipe,0),cubics=pathCubics(recipe.waypoints,recipe.options,true);
	near(handles.incoming,cubics.at(-1)[2]);
	recipe=changePathPointMode(recipe,0,'smooth');
	const hit=nearestPathSegment(recipe,{x:-20,y:100});
	assert.equal(hit.index,4);
	const result=insertPathWaypoint(recipe,hit.point,1);
	assert.equal(result.index,4);assert.equal(result.recipe.closed,true);
	near(evaluatePathRecipe(result.recipe).points[0],evaluatePathRecipe(result.recipe).points.at(-1));
	for(const p of evaluatePathRecipe(result.recipe).points)assert.ok(nearestPathSegment(recipe,p).distance<=1);
	recipe=changePathOptions(recipe,{meander:0.2});
	const route=evaluatePathRecipe(recipe),lastAnchor=route.points.findIndex(p=>p.x===0&&p.y===200);
	assert.equal(nearestPathSegment(recipe,route.points[Math.floor((lastAnchor+route.points.length-1)/2)]).index,4);
	assert.equal(insertPathWaypoint(recipe,route.points[Math.floor((lastAnchor+route.points.length-1)/2)]).recipe.waypoints.length,5);
	assert.throws(()=>changePathClosure(createPathRecipe(points.slice(0,2)),true),/waypoint count/);
	assert.throws(()=>changePathClosure(recipe,'true'),/closure/);
});

test('appearance patches preserve points and seed, tint all primary styles, support thin strokes and refuse invalid options',()=>{
	for(const style of ['plain','railway','road','river']){
		const input=createPathRecipe(points,{style,spacing:1});
		const recipe=changePathOptions(input,{color:'#ff00aa',alpha:0.3,width:0.01});
		assert.deepEqual(recipe.waypoints,input.waypoints);assert.equal(recipe.options.seed,input.options.seed);
		const parts=buildPathRecipeComponents(recipe);
		const primary=parts.filter(p=>['path','rail-left','rail-right','surface'].includes(p.role));
		assert.ok(primary.every(p=>p.data.strokeColor==='#ff00aa'));
		assert.ok(parts.every(p=>p.data.strokeAlpha===0.3));
		if(style==='plain')assert.equal(parts[0].data.strokeWidth,1);
		assert.equal(input.options.alpha,1);
		assert.throws(()=>changePathOptions(input,{width:0}),/Invalid/);
		assert.throws(()=>changePathOptions(input,{mystery:1}),/Invalid/);
		const rerolled=changePathOptions(input,{meander:0.2,seed:nextPathSeed(input.options.seed)});
		assert.notDeepEqual(evaluatePathRecipe(rerolled).points,evaluatePathRecipe(changePathOptions(input,{meander:0.2})).points);
	}
	assert.notEqual(nextPathSeed(0xffffffff),0xffffffff);
	assert.throws(()=>nextPathSeed(-1),/Invalid/);
});

test('user presets register, save complete settings/closure, apply without seed or points and delete independently',async()=>{
	registerPathPresetSetting();assert.equal(registration.scope,'user');assert.deepEqual(registration.default,{version:1,presets:null});
	const starters=readPathPresets();assert.equal(starters.length,4);assert.equal(starters[0].options.width,0.03);
	const preset=await savePathPreset('  Quarry road  ',pathOptions({style:'road',width:1.2,seed:765}),true);
	assert.equal(readPathPresets().at(-1).name,'Quarry road');
	const patch=pathPresetPatch(preset);assert.equal(patch.closed,true);assert.equal(patch.style,'road');assert.equal('seed' in patch,false);
	const recipe=createPathRecipe(points,{seed:123});const {closed,...options}=patch;
	const applied=changePathClosure(changePathOptions(recipe,options),closed);
	assert.equal(applied.options.seed,123);assert.deepEqual(applied.waypoints,recipe.waypoints);
	await deletePathPreset(preset.id);assert.equal(readPathPresets().length,4);
	await assert.rejects(deletePathPreset('missing'),/PresetChanged/);
});

test('preset corruption, limits, persistence errors and invalid names fail explicitly',async()=>{
	for(const data of [{version:9,presets:null},{version:1,presets:[{}]},{version:1,presets:null,unknown:true}]){
		assert.throws(()=>validatePathPresets(data),/PresetInvalid/);
	}
	await assert.rejects(savePathPreset('',pathOptions(),false),/PresetInvalid/);
	await assert.rejects(savePathPreset('x'.repeat(61),pathOptions(),false),/PresetInvalid/);
	const base=readPathPresets()[0];
	presets={version:1,presets:Array.from({length:MAX_PATH_PRESETS},(_,i)=>({...base,id:`preset${i}`}))};
	await assert.rejects(savePathPreset('Full',pathOptions(),false),/PresetFull/);
	presets={version:1,presets:null};
	game.settings.set=async()=>{throw new Error('preset persistence failed');};
	await assert.rejects(savePathPreset('Failure',pathOptions(),false),/persistence failed/);
});
