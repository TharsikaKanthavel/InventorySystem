import test from 'node:test';
import assert from 'node:assert/strict';
import {assetCounts} from '../src/asset-counts.js';
const assets=[{branch:'JAFFNA',category:'Medical',item:'Scanner'},{branch:'JAFFNA',category:'Medical',item:'Scanner'},{branch:'MOOLAI',category:'Medical',item:'Scanner'},{branch:'MOOLAI',category:'Furniture',item:'Chair'}];
test('compares matching items across branches without double counting',()=>{const rows=assetCounts(assets,['JAFFNA','MOOLAI'],true);assert.deepEqual(rows.find(r=>r.Item==='Scanner'),{Category:'Medical',Item:'Scanner',JAFFNA:2,MOOLAI:1,Total:3});assert.equal(rows.at(-1).Total,4);assert.equal(rows.find(r=>r.Item==='Chair').JAFFNA,0);});
test('separate branch report counts records and empty branch totals zero',()=>{const rows=assetCounts(assets.filter(a=>a.branch==='JAFFNA'),[]);assert.equal(rows[0]['Asset records'],2);assert.equal(rows.at(-1)['Asset records'],2);assert.equal(assetCounts([],[]).at(-1)['Asset records'],0);});
