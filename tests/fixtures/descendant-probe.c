// Offline native fixture: no credentials/network. Every long-lived process has
// an alarm as an independent cleanup backstop if the tested supervisor fails.
#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
extern char **environ;
static int change_group(int session) {
 pid_t p=fork(); if(p<0)return 99;
 if(!p){errno=0;int result=session?setsid():setpgid(0,0);_exit(result<0?errno:0);}
 int status;if(waitpid(p,&status,0)<0||!WIFEXITED(status))return 99;return WEXITSTATUS(status);
}
static int spawn_group(char *self,short flags){
 posix_spawnattr_t attr;posix_spawnattr_init(&attr);posix_spawnattr_setflags(&attr,flags);posix_spawnattr_setpgroup(&attr,0);
 char *args[]={self,"child",NULL};pid_t p;int r=posix_spawn(&p,self,NULL,&attr,args,environ);if(!r)waitpid(p,NULL,0);posix_spawnattr_destroy(&attr);return r;
}
static void record(const char *path){
 int fd=open(path,O_WRONLY|O_CREAT|O_APPEND,0600);if(fd<0)_exit(98);char text[96];int n=snprintf(text,sizeof(text),"%d %d\n",getpid(),getpgrp());if(write(fd,text,n)!=n)_exit(97);close(fd);
}
int main(int argc,char **argv){
 if(argc>1&&!strcmp(argv[1],"child"))return 0;
 if(argc>1&&!strcmp(argv[1],"identity")){printf("%d %d\n",getpid(),getpgrp());return 0;}
 if(argc>2&&(!strcmp(argv[1],"tree")||!strcmp(argv[1],"tree-exit"))){
  alarm(10);record(argv[2]);pid_t p=fork();if(p<0)return 95;
  if(!p){alarm(10);setsid();setpgid(0,0);record(argv[2]);pid_t grand=fork();if(grand<0)_exit(94);if(grand)_exit(0);alarm(10);setsid();setpgid(0,0);record(argv[2]);for(;;)pause();}
  waitpid(p,NULL,0);if(!strcmp(argv[1],"tree-exit")){usleep(200000);return 0;}for(;;)pause();
 }
 printf("%d %d %d %d %d\n",change_group(1),change_group(0),spawn_group(argv[0],POSIX_SPAWN_SETSID),spawn_group(argv[0],POSIX_SPAWN_SETPGROUP),spawn_group(argv[0],0));
 return 0;
}
