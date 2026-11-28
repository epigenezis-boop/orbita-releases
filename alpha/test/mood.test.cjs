'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const M=require('../src/mood-model.js');
test('mood pad retains current protocol defaults and maps both axes independently',()=>{const p=M.toPoint(.75,1.03);assert.equal(p.y,.5);assert.equal(p.x,.515);assert.deepEqual(M.fromPoint(p.x,p.y),M.defaults);assert.deepEqual(M.fromPoint(0,0),{energy:1.5,fun:0});assert.deepEqual(M.fromPoint(1,1),{energy:0,fun:2});});
test('pointer positions outside the pad remain finite and bounded',()=>{assert.deepEqual(M.fromPoint(-10,100),{energy:0,fun:0});assert.deepEqual(M.fromPoint(100,-10),{energy:1.5,fun:2});for(const n of [NaN,Infinity,-Infinity])for(const v of Object.values(M.fromPoint(n,n)))assert.ok(Number.isFinite(v));});
