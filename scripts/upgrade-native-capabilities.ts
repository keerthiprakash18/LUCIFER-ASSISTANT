import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {policySchema} from '../companion/policy.js';
const file=path.resolve('.local/native/policy.json');
const policy=policySchema.parse(JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,'')));
// Explicit installation step for the owner's requested action-assistant upgrade.
// Existing aliases, folders, disabled browser preference and credentials are retained.
for(const action of ['discover_apps','observe_app','browser_action','open_document','edit_file','move_file'] as const)if(!policy.actions.includes(action))policy.actions.push(action);
if(policy.browserAccess===undefined)policy.browserAccess=true;
const temporary=file+'.upgrade.tmp';await writeFile(temporary,JSON.stringify(policy),{mode:0o600});await rename(temporary,file);
console.log('Requested native capabilities installed. Existing scopes/pairing retained; edits/moves require exact confirmation.');
