import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {runGrokSmoke} from '../src/grok-smoke.ts';

if (!process.argv.includes('--live')) throw new Error('Pass --live to explicitly run one paid Grok request');
if (!process.env.XAI_API_KEY?.trim()) throw new Error('XAI_API_KEY is required');
process.env.GROK_REASONING_EFFORT = 'low';
process.env.GROK_MAX_OUTPUT_TOKENS = '128';
const directory = resolve('runs', `grok-semantic-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(directory, {recursive: true});
const result = await runGrokSmoke();
writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({directory, ...result}));
process.exitCode = Object.values(result.checks).every(value => value === 'passed') ? 0 : 1;
