import {mkdir,writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

// Runs produce disposable output. Accepted snapshots are promoted manually.
export async function writeEvidence(name,record,output) {
 const target=output??fileURLToPath(new URL(`../test-results/${name}.json`,import.meta.url))
 await mkdir(dirname(target),{recursive:true})
 await writeFile(target,JSON.stringify(record,null,2)+'\n')
 return target
}
