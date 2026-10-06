import '../server/config.js';
import { spawn } from 'node:child_process';
import path from 'node:path';
const p=spawn(process.execPath,[path.resolve('node_modules/playwright/cli.js'),'install','chromium'],{stdio:'inherit',env:process.env,shell:false});
p.once('exit',code=>{process.exitCode=code??1;});
