# KTH Biblioteket Alma Tasks
- Skicka TDIG till Libris, Skörda nya böcker etc
- Importera nya poster från Libris

##

### Libris Integration

Varje minut körs en task som hämtar poster som uppdaterats/skapats i Libris.
Posten skapas sedan i Alma.
 - Bib
 - Holding
 - Item


Sök i alma efter borrowing requests
https://eu01-psb.alma.exlibrisgroup.com/view/sru/46KTH_INST?version=1.2&operation=searchRetrieve&recordSchema=marcxml&query=alma.permanentPhysicalLocation=%22OUT_RS_REQ%22%20AND%20alma.title=ankor

https://eu01-psb.alma.exlibrisgroup.com/view/sru/46KTH_INST?version=1.2&operation=searchRetrieve&recordSchema=marcxml&query=alma.permanentPhysicalLocation=%22OUT_RS_REQ%22%20AND%20(alma.isbn=9783753302980%20OR%20alma.title=%22Pingvinerna%22)



#### Dependencies

Node 16.17.0

### Install
Skapa docker-compose.yml
```
services:
  almatools-tasks:
    container_name: "almatools-tasks"
    image: ghcr.io/kth-biblioteket/almatools-tasks:${REPO_TYPE}
    restart: "always"
    environment:
      TZ: ${TZ}
    env_file:
      - almatools-tasks.env
    volumes:
      - "./logs:/app/logs"
      - "./lastuntiltime.txt:/app/lastuntiltime.txt"
    networks:
      - "apps-net"

networks:
  apps-net:
    external: true
```

Skapa folder logs
Skapa filen almatools-tasks.env
````
DATABASEHOST=almatools-db
DB_DATABASE=almatools
DB_USER=almatools
DB_PASSWORD=xxxxxx
DB_ROOT_PASSWORD=xxxxxx
SMTP_HOST=relayhost.sys.kth.se
MAILFROM_NAME_SV=KTH Bibliotekets
MAILFROM_NAME_EN=KTH Library
MAILFROM_ADDRESS=noreply@kth.se
MAIL_ERROR_TO_ADDRESS=tholind@kth.se
MAILFROM_SUBJECT_SV=
MAILFROM_SUBJECT_EN=
LDAP_USER=sys-bibliometri@ug.kth.se
LDAP_PWD="xxxxxxxx"
LIBRIS_HOSTNAME=libris.kb.se
ALMA_SRU_HOSTNAME=eu01-psb.alma.exlibrisgroup.com
ALMA_API_HOSTNAME=api-eu.hosted.exlibrisgroup.com
ALMA_TDIG_JOB_PATH=conf/jobs/M47
OLD_ALMA_TDIG_SET_ID=2036151600002456
ALMA_TDIG_SET_ID=29469454330002456
ALMA_LINK_SERVER_URL=https://kth-ch.primo.exlibrisgroup.com/openurl/46KTH_INST/46KTH_INST:46KTH_VU1_L?
ALMA_API_ENDPOINT=https://api-eu.hosted.exlibrisgroup.com/almaws/v1/
ALMA_APIKEY_PROD=xxxxxx
ALMA_APIKEY_PSB=xxxxxx
ALMA_APIKEY=xxxxxx
API_KEY_WRITE=xxxxxx
DEFAULT_COVER_URL=https://apps.lib.kth.se/images/book.png
SYNDETICS_COVER_URL=http://syndetics.com/index.php
PRIMO_XSERVICE_ENDPOINT=https://pmt-eu.hosted.exlibrisgroup.com/PrimoWebServices/xservice/search/brief
ALMA_ANALYTICS_API_ENDPOINT_EBOOKS = https://api-eu.hosted.exlibrisgroup.com/almaws/v1/analytics/reports?path=/shared/Royal Institute of Technology/Reports/new_ebooks&apikey=xxxxxx
ALMA_ANALYTICS_API_ENDPOINT_PBOOKS = https://api-eu.hosted.exlibrisgroup.com/almaws/v1/analytics/reports?path=/shared/Royal Institute of Technology/Reports/new_pbooks&apikey=xxxxxx
CRON_TDIG_ACTIVE=false
CRON_TDIG=05 12 * * *
CRON_PBOOKS_ACTIVE=false
CRON_PBOOKS=00 23 * * *
CRON_EBOOKS_ACTIVE=false
CRON_EBOOKS=20 23 * * *
CRON_LIBRISIMPORT_ACTIVE=true
CRON_LIBRISIMPORT=* * * * *
ENVIRONMENT=development
LOG_LEVEL=debug
MAX_TITLES_TO_ADD=1000
#DELETEBOOKS=true
#FORCEACTIVATIONDATE=2022-01-01
````

Skapa filen .env
````
DOMAIN_NAME=sys-ref.lib.kth.se
REPO_TYPE=ref
TZ=Europe/Stockholm
```

Skapa filen lastuntiltime.txt