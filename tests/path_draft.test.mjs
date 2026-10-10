import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPathRecipe } from '../scripts/path_schema.js';
import { changePathWaypoint, removePathWaypoint, nearestPathSegment, insertPathWaypoint,
	changePathPointMode, changePathHandle } from '../scripts/path_draft.js';
import { evaluatePathRecipe, buildPathRecipeComponents } from '../scripts/path_store.js';
import { pathCubics, splitPathCubic } from '../scripts/path_geometry.js';

const cubicPoint = ([a,b,c,d],t) => ({x:(1-t)**3*a.x+3*(1-t)**2*t*b.x+3*(1-t)*t*t*c.x+t**3*d.x,
	y:(1-t)**3*a.y+3*(1-t)**2*t*b.y+3*(1-t)*t*t*c.y+t**3*d.y});
const near = (a,b,tolerance=1e-8) => assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<tolerance,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
function polylineDistance(points,p) {
	return Math.min(...points.slice(1).map((b,index)=>{
		const a=points[index],dx=b.x-a.x,dy=b.y-a.y;
		const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
		return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
	}));
}

test('manual handles preserve translation, linked directions and independent Corner control', () => {
	const original=createPathRecipe([{x:0,y:0},{x:200,y:100},{x:500,y:0}],{style:'plain'});
	let recipe=changePathPointMode(original,1,'smooth');
	const oppositeLength=Math.hypot(recipe.waypoints[1].incoming.x-200,recipe.waypoints[1].incoming.y-100);
	recipe=changePathHandle(recipe,1,'outgoing',{x:240,y:140});
	near(recipe.waypoints[1].incoming,{x:200-oppositeLength/Math.sqrt(2),y:100-oppositeLength/Math.sqrt(2)});
	recipe=changePathPointMode(recipe,1,'corner');
	const incoming=structuredClone(recipe.waypoints[1].incoming);
	recipe=changePathHandle(recipe,1,'outgoing',{x:100,y:180});
	assert.deepEqual(recipe.waypoints[1].incoming,incoming);
	const moved=changePathWaypoint(recipe,1,{x:210,y:120});
	near(moved.waypoints[1].outgoing,{x:110,y:200});
	near(moved.waypoints[1].incoming,{x:incoming.x+10,y:incoming.y+20});
	assert.deepEqual(changePathPointMode(moved,1,'automatic').waypoints[1],{x:210,y:120,mode:'automatic',incoming:null,outgoing:null});
	assert.throws(()=>changePathHandle(original,1,'incoming',{x:0,y:0}),/manual/);
	assert.throws(()=>changePathHandle(recipe,1,'outgoing',{x:Infinity,y:0}),/coordinates/);
	assert.equal(original.waypoints[1].mode,'automatic');
});

test('curve subdivision preserves every cubic exactly and evaluated artwork within flattening tolerance', () => {
	for(const style of ['plain','road','river','railway']) {
		const recipe=createPathRecipe([{x:0,y:0},{x:200,y:100},{x:500,y:0}],{style});
		const before=pathCubics(recipe.waypoints,recipe.options);
		const route=evaluatePathRecipe(recipe), hit=route.points[Math.floor(route.points.length/4)];
		const nearest=nearestPathSegment(recipe,hit);
		const t=nearest.span.t0+nearest.t*(nearest.span.t1-nearest.span.t0);
		const result=insertPathWaypoint(recipe,hit,1).recipe;
		const after=pathCubics(result.waypoints,result.options), segment=nearest.index-1;
		const expected=splitPathCubic(before[segment],t);
		for(let j=0;j<2;j++)for(let step=0;step<=100;step++) near(cubicPoint(after[segment+j],step/100),cubicPoint(expected[j],step/100));
		near(cubicPoint(before[segment],t),result.waypoints[nearest.index]);
		for(let step=0;step<=100;step++) near(cubicPoint(after.at(-1),step/100),cubicPoint(before.at(-1),step/100));
		assert.ok(buildPathRecipeComponents(result).length>0);
		for(const point of evaluatePathRecipe(result).points) assert.ok(nearestPathSegment(recipe,point).distance<=route.tolerance*2);
		const generated=evaluatePathRecipe(result).points;
		for(const point of generated) assert.ok(polylineDistance(route.points,point)<=route.tolerance*2);
		for(const point of route.points) assert.ok(polylineDistance(generated,point)<=route.tolerance*2);
	}
});

test('manual loop-back handles, meander and self-intersections have bounded valid evaluated routes', () => {
	let recipe=createPathRecipe([{x:0,y:0},{x:100,y:0}],{style:'plain'});
	recipe=changePathPointMode(recipe,0,'corner');
	recipe=changePathHandle(recipe,0,'outgoing',{x:300,y:0});
	assert.ok(evaluatePathRecipe(recipe).points.some(p=>p.x>100));
	recipe.options.meander=0.1;
	assert.ok(evaluatePathRecipe(recipe).length>100);
	const crossing=createPathRecipe([{x:0,y:0},{x:100,y:100},{x:0,y:100},{x:100,y:0}],{style:'plain',curve:'straight'});
	assert.equal(insertPathWaypoint(crossing,{x:50,y:50}).index,1);
	assert.throws(()=>insertPathWaypoint(crossing,{x:0,y:0}),/between/);
});

test('straight insertion projects onto the correct segment without changing the original route', () => {
	const recipe = createPathRecipe([{x:0,y:0},{x:100,y:0},{x:100,y:100}],{style:'plain',curve:'straight'});
	const result = insertPathWaypoint(recipe,{x:105,y:50},10);
	assert.equal(result.index,2);
	result.recipe.waypoints.forEach((point,index)=>near(point,[{x:0,y:0},{x:100,y:0},{x:100,y:50},{x:100,y:100}][index],1e-6));
	assert.equal(recipe.waypoints.length,3);
	assert.equal(evaluatePathRecipe(result.recipe).length,evaluatePathRecipe(recipe).length);
	assert.throws(()=>insertPathWaypoint(recipe,{x:200,y:200},5),/preview/);
	near(insertPathWaypoint(recipe,{x:100,y:25}).recipe.waypoints[2],{x:100,y:25},1e-6);
});

test('smooth and seeded meander insertion maps evaluated segments back to waypoint intervals', () => {
	for(const meander of [0,0.4]) {
		const recipe=createPathRecipe([{x:0,y:0},{x:200,y:100},{x:500,y:0}],{style:'plain',meander,seed:42});
		const points=evaluatePathRecipe(recipe).points;
		const middle=points.findIndex(p=>Math.hypot(p.x-200,p.y-100)<0.01);
		assert.ok(middle>0);
		for(const [index,expected] of [[Math.floor(middle/2),1],[Math.floor((middle+points.length-1)/2),2]]) {
			const hit=nearestPathSegment(recipe,points[index]);
			assert.equal(hit.index,expected);
			assert.ok(hit.distance<1e-8);
		}
	}
});

test('draft endpoint movement and deletion validate geometry and never mutate input', () => {
	const recipe=createPathRecipe([{x:0,y:0},{x:100,y:0},{x:200,y:100}],{style:'plain'});
	const moved=changePathWaypoint(recipe,0,{x:-30,y:20});
	assert.equal(moved.waypoints[0].x,-30);assert.equal(recipe.waypoints[0].x,0);
	assert.equal(removePathWaypoint(recipe,0).waypoints[0].x,100);
	assert.throws(()=>changePathWaypoint(recipe,1,{x:0,y:0}),/distinct/);
	assert.throws(()=>removePathWaypoint(removePathWaypoint(recipe,0),0),/waypoint count/);
	assert.throws(()=>changePathWaypoint(recipe,9,{x:2,y:3}),/selection/);
});
