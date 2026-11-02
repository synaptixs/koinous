import {setup} from '../src/subscription-setup.ts';
try{console.log(await setup(process.argv.slice(2)));}catch(error){console.error(error instanceof Error?error.message:'Setup failed.');process.exitCode=1;}
