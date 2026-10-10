import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPathHistoryState, preparePathHistory, recordPathHistory, replayPathHistory, planPathHistoryReplay,
	clearPathHistory, PATH_HISTORY_LIMITS } from '../scripts/path_history.js';
import { createPathRecipe } from '../scripts/path_schema.js';
import { translatePathRecipe, changePathPointMode } from '../scripts/path_draft.js';

const registry=()=>({version:1,revision:0,routes:[]});
const entry=(n=0)=>preparePathHistory(registry(),registry(),[{_id:'drawing',x:n}],[{_id:'drawing',x:n+1}],'Edit');
let scene;
beforeEach(()=>{
	scene={};globalThis.game={user:{id:'gm'},i18n:{localize:key=>key}};globalThis.Hooks={callAll:()=>{}};
});

test('history is bounded, GM/Scene-local, drops redo after a new operation and clears explicitly',async()=>{
	for(let i=0;i<22;i++)recordPathHistory(scene,entry(i));
	let count=0;while(getPathHistoryState(scene).undo){await replayPathHistory(scene,'undo',async()=>{count++;});}
	assert.equal(count,PATH_HISTORY_LIMITS.entries);
	assert.equal(getPathHistoryState(scene).redo,true);
	recordPathHistory(scene,entry(99));assert.equal(getPathHistoryState(scene).redo,false);
	game.user.id='another';assert.equal(getPathHistoryState(scene).undo,false);
	game.user.id='gm';assert.equal(getPathHistoryState(scene).undo,true);
	assert.equal(getPathHistoryState({}).undo,false);
	clearPathHistory(scene);assert.equal(getPathHistoryState(scene).undo,false);
});

test('history byte limit evicts older entries and refuses a single oversized operation before recording',()=>{
	const e=entry();e.bytes=PATH_HISTORY_LIMITS.bytes/2+1;
	recordPathHistory(scene,e);recordPathHistory(scene,e);
	assert.equal(getPathHistoryState(scene).undo,true);
	assert.throws(()=>preparePathHistory(registry(),registry(),[],[{_id:'drawing',data:'x'.repeat(PATH_HISTORY_LIMITS.bytes)}],'Create'),/HistoryLimit/);
	assert.equal(preparePathHistory(registry(),registry(),[],[],'Edit'),null);
});

test('failed replay preserves cursor and busy clears; simultaneous replay refuses',async()=>{
	recordPathHistory(scene,entry());
	let release;
	const active=replayPathHistory(scene,'undo',()=>new Promise(resolve=>{release=resolve;}));
	assert.equal(getPathHistoryState(scene).busy,true);
	await assert.rejects(replayPathHistory(scene,'undo',async()=>{}),/HistoryConflict/);
	release();await active;
	assert.equal(getPathHistoryState(scene).busy,false);
	await assert.rejects(replayPathHistory(scene,'redo',async()=>{throw new Error('write failed');}),/write failed/);
	assert.equal(getPathHistoryState(scene).redo,true);
});

test('replay touches only recorded sources/routes, increments revisions and refuses conflicting source or route data',()=>{
	const route={id:'route',revision:1,name:'Path'},changed={...route,name:'Changed',revision:2};
	const before={...registry(),routes:[route]},after={...registry(),revision:1,routes:[changed]};
	const e=preparePathHistory(before,after,[{_id:'drawing',x:1}],[{_id:'drawing',x:2}],'Edit');
	const current={...after,revision:20,routes:[{...changed,revision:30},{id:'other',revision:50,name:'Another'}]};
	const sources=[{_id:'drawing',x:2},{_id:'peer',x:999}];
	const plan=planPathHistoryReplay(e,true,current,sources);
	assert.equal(plan.registry.revision,21);assert.equal(plan.registry.routes.find(r=>r.id==='route').revision,31);
	assert.deepEqual(plan.registry.routes.find(r=>r.id==='other'),current.routes[1]);
	assert.deepEqual(plan.after.find(d=>d._id==='peer'),sources[1]);
	assert.throws(()=>planPathHistoryReplay(e,true,current,[{_id:'drawing',x:3}]),/HistoryConflict/);
	assert.throws(()=>planPathHistoryReplay(e,true,{...current,routes:[{...changed,name:'External'}]},sources),/HistoryConflict/);
});

test('whole translation preserves handles, closure/options and length without mutating the original recipe',()=>{
	let recipe=createPathRecipe([{x:0,y:0},{x:200,y:100},{x:400,y:0}],{style:'plain',meander:0.2});
	recipe=changePathPointMode(recipe,1,'corner');recipe.closed=true;
	const translated=translatePathRecipe(recipe,-20,70);
	for(const [index,point]of translated.waypoints.entries()){
		assert.equal(point.x,recipe.waypoints[index].x-20);assert.equal(point.y,recipe.waypoints[index].y+70);
		for(const side of ['incoming','outgoing'])if(point[side]){
			assert.equal(point[side].x,recipe.waypoints[index][side].x-20);
			assert.equal(point[side].y,recipe.waypoints[index][side].y+70);
		}
	}
	assert.deepEqual(translated.options,recipe.options);assert.equal(translated.closed,true);
	assert.throws(()=>translatePathRecipe(recipe,NaN,0),/finite/);
	assert.throws(()=>translatePathRecipe(recipe,1e8,0),/coordinates/);
});

test('resurrecting a deleted route never reuses an earlier expected revision',()=>{
	const route={id:'route',revision:0,name:'Path'},before={...registry(),routes:[route]};
	const e=preparePathHistory(before,registry(),[{_id:'drawing'}],[],'DeleteWhole');
	const first=planPathHistoryReplay(e,true,{...registry(),revision:4},[]);
	const second=planPathHistoryReplay(e,true,{...registry(),revision:10},[]);
	assert.equal(first.registry.routes[0].revision,5);
	assert.equal(second.registry.routes[0].revision,11);
});
