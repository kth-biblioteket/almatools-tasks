# KTH Biblioteket Alma Tasks
- Skicka TDIG till Libris, Skörda nya böcker etc

##

###


#### Dependencies

Node 16.13.2

### Install
Skapa docker-compose.yml
```
version: "3.6"

services:
  almatools-tasks:
    container_name: "almatools-tasks"
    image: ghcr.io/kth-biblioteket/almatools-tasks:${REPO_TYPE}
    restart: "always"
    environment:
      TZ: ${TZ}
    env_file:
      - almatools-tasks.env
    networks:
      - "apps-net"

networks:
  apps-net:
    external: true
```