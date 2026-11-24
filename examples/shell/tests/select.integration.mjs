import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
test('native TLS wait survives repeated signals without extending its deadline',{skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'shell-select-'))
 try{
 const header=resolve('../../engine/core/templates/harness/swelte_shutdown.h')
 await writeFile(join(dir,'test.c'),`#include <unistd.h>
#include <sys/time.h>
#include <sys/wait.h>
#include "${header}"
static void tick(int n) {}
int main(void) {
 int p[2];pipe(p);signal(SIGALRM,tick);
 struct itimerval timer={{0,10000},{0,10000}};setitimer(ITIMER_REAL,&timer,0);
 pid_t child=fork();if(!child){usleep(150000);write(p[1],"x",1);_exit(0);}
 fd_set f;FD_ZERO(&f);FD_SET(p[0],&f);struct timeval timeout={0,500000};
 if(select(p[0]+1,&f,0,0,&timeout)!=1||!FD_ISSET(p[0],&f))return 1;
 char c;read(p[0],&c,1);waitpid(child,0,0);
 struct timespec a,b;clock_gettime(CLOCK_MONOTONIC,&a);
 FD_ZERO(&f);FD_SET(p[0],&f);timeout.tv_sec=0;timeout.tv_usec=100000;
 if(select(p[0]+1,&f,0,0,&timeout)!=0)return 2;
 clock_gettime(CLOCK_MONOTONIC,&b);
 long elapsed=(b.tv_sec-a.tv_sec)*1000+(b.tv_nsec-a.tv_nsec)/1000000;
 return elapsed<80||elapsed>300?3:0;
}`)
 execFileSync(process.env.CC??'cc',[join(dir,'test.c'),'-o',join(dir,'test')],{env:{...process.env,PATH:'/usr/bin:/bin'}})
 assert.doesNotThrow(()=>execFileSync(join(dir,'test'),[],{timeout:2000}))
 }finally{await rm(dir,{recursive:true,force:true})}
})
