# KTH Biblioteket Alma Tasks
- Skicka TDIG till Libris, Skörda nya böcker etc

##

### Libris Integration

- Sök i alma efter borrowing requests
https://eu01-psb.alma.exlibrisgroup.com/view/sru/46KTH_INST?version=1.2&operation=searchRetrieve&recordSchema=marcxml&query=alma.permanentPhysicalLocation=%22OUT_RS_REQ%22%20AND%20alma.title=ankor

https://eu01-psb.alma.exlibrisgroup.com/view/sru/46KTH_INST?version=1.2&operation=searchRetrieve&recordSchema=marcxml&query=alma.permanentPhysicalLocation=%22OUT_RS_REQ%22%20AND%20(alma.isbn=9783753302980%20OR%20alma.title=%22Pingvinerna%22)



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