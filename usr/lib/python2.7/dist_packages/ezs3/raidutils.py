import collections
import glob
import os
import errno
import re
import json
import _ped
import parted
import datetime
import time
import math
from ezs3.command import do_cmd, DoCommandError, do_cmd_with_progress
from ezs3.log import EZLog
from ezs3 import remote
from ezs3.lock import ProcessLock, FILE_RESOURCE
from ezs3.defaults import BigTeraDefaultSettings as defaults
from ezs3.remote import update_task_info, TASK_TICKET
from ezs3.central_log import get_central_logger
from ezs3.config import Ezs3CephConfig
from ezs3.cache import LocalCache
from ezs3.utils import mount_fs
from ezmonitor.cluster_metric_manager import ClusterMetricManager
VERSION = "V1.1"
logger = EZLog.get_logger(__name__)
cl = get_central_logger()
ALIGNMENT_SECTORS = 2048
NAS_DISKS_CONF = "/etc/ezs3/nas_disks.conf"
NAS_MOUNT_POINT_PREFIX = "/mnt/nas/loop_"
MULTIPATH_CONF = "/etc/multipath.conf"
MEGACLI_BIN = '/opt/MegaRAID/MegaCli/MegaCli64'
A1100_PRODUCTNAME = "RS300-E8-RS4"
A1970_PRODUCTNAME = "1970"
EXE_PATH = "/promise/bin"
RAID_CONFIG = "/etc/ezs3/raid_conf"
SIMULATION_MODE = 0
HEAD = "Head"
JBOD1 = "JBOD1"
JBOD2 = "JBOD2"
JBOD3 = "JBOD3"

@remote.callable
def list_raids():
    logger.info("andy in list_raids")
    productname = get_productname()
    logger.info("productname: %s", productname)
    if not os.path.isfile(RAID_CONFIG):
        if SIMULATION_MODE:
            productname = "RS300-E8-RS4"
        else:
            productname = get_productname()
            logger.info("productname: %s", productname)
        #print "not RAID_CONFIG"
        create_raid_config_file()
    #init_raid_config_file(productname)
    size_raid_conf = get_size_raid_conf()
    if size_raid_conf <4:
        init_raid_config_file(productname)     
    update_raid_config_file()
    with open(RAID_CONFIG) as infp:
        for line in infp:
            DATA = eval(line)
    return DATA
#if file not existed
def create_raid_config_file():
    do_cmd("echo \"[]\" > " + RAID_CONFIG)
    #print "create_raid_config_file"
def init_raid_config_file(productname):
    #logger.info("productname: %s", productname)
    if A1100_PRODUCTNAME in productname:
        print ""
        raids = []
        raid = []
        raidc = "15 + 1 RAID 5"
        status = "Created"
        status1 = "Not Created"
        head = HEAD
        descriptionJ = "JBOD"
        jbod1 = JBOD1
        jbod2 = JBOD2
        jbod3 = JBOD3
        description = ""
        raidH = {'storage_box': head , 'raidconfig': raidc, 'r_status': status1, 'r_description': description}
        raidJ1 = {'storage_box': jbod1, 'raidconfig': raidc, 'r_status': status1, 'r_description': description}
        raidJ2 = {'storage_box': jbod2, 'raidconfig': raidc, 'r_status': status1, 'r_description': description}
        raidJ3 = {'storage_box': jbod3, 'raidconfig': raidc, 'r_status': status1, 'r_description': description}
        #raidJ3 = {'raidconfig': raidc, 'r_status': status1, 'r_description': descriptionJ3}
        if SIMULATION_MODE:
            raids.append(raidH)
            raids.append(raidJ1)
            raids.append(raidJ2)
            raids.append(raidJ3)
            phdrv_count_A1100 = 0
        else:
            phdrv_count_A1100 = count_phydrv_A1100()
        if phdrv_count_A1100 ==16:
            raids.append(raidH)
        elif phdrv_count_A1100 ==32:
            raids.append(raidH)
            raids.append(raidJ1)
        elif phdrv_count_A1100 ==48:
            raids.append(raidH)
            raids.append(raidJ1)
            raids.append(raidJ2)
        elif phdrv_count_A1100 ==64:
            raids.append(raidH)
            raids.append(raidJ1)
            raids.append(raidJ2)
            raids.append(raidJ3)
        #for(i = 1; i< 4; i++){
        #    raid[i] = ['raidconfig': raidc, 'r_status': status1, 'r_description': descriptionJ]
        #    raids.append(raid[i])
        #}
    file_ = open(RAID_CONFIG, 'w')
    file_.write("{}".format(raids))
    file_.close()
    update_raid_config_file()

#r_description: Header, JBOD1, JBOD2, JBOD3
def create_raids(storage_box):
    if not SIMULATION_MODE:
        productname = get_productname()
    array_status = 0 #-1: failed, 0: existed, 1: success
    spare_status = 0 #-1: failed, 0: existed, 1: success

    if SIMULATION_MODE:
        array_status = 1 
        spare_status = 1 #2: r_status: Not Created
        #spare_status = 1
        update_r_status_config_file(storage_box, array_status, spare_status)
        return
        #return 1, 1
        #return array_status, spare_status

    if A1100_PRODUCTNAME in productname:
        phdrv_count_A1100 = count_phydrv_A1100()
        count_ok_array = do_cmd("cliib -u admin -p password -C array -a list |grep -E *'OK' |wc -l")
        count_ok_spare = do_cmd("cliib -u admin -p password -C spare -a list |grep -E *'OK' |wc -l")
        if(storage_box == HEAD):
            if count_ok_array == "1\n":
                print("RAID existed")
                array_status = 0
            else:
                do_cmd("cliib -u admin -p password -C array -a add -p1~15 -l\\\"raid=5\\\"")
                array_status = 1
                do_cmd("cliib -u admin -p password -C spare -a add -p 16 -t g -r y")
                spare_status = 1
        elif(storage_box == JBOD1):#need to check if JBOD1 is created or not
                do_cmd("cliib -u admin -p password -C array -a add -p17~31 -l\\\"raid=5\\\"")
                array_status = 1
                do_cmd("cliib -u admin -p password -C spare -a add -p 32 -t g -r y")
                spare_status = 1
        elif(storage_box == JBOD2):#need to check if JBOD2 is created or not
                do_cmd("cliib -u admin -p password -C array -a add -p33~47 -l\\\"raid=5\\\"")
                array_status = 1
                do_cmd("cliib -u admin -p password -C spare -a add -p 48 -t g -r y")
                spare_status = 1
        elif(storage_box == JBOD3):#need to check if JBOD2 is created or not
                do_cmd("cliib -u admin -p password -C array -a add -p49~63 -l\\\"raid=5\\\"")
                array_status = 1
                do_cmd("cliib -u admin -p password -C spare -a add -p 64 -t g -r y")
                spare_status = 1
        update_raid_config_file()
        return array_status, spare_status
    #A1970
    elif A1970_PRODUCTNAME in productname:
        is_VD = do_cmd("{}/check_mcli_array.sh".format(EXE_PATH))
        if is_VD == "VD\nVD\nVD\n":
            print("RAID existed")
            raid_status = 0
            spare_status = 0
        #elif phydrv_count_A1970 == 35:
        else:# do not  ccj # no JBOD, so no need to count drive
            FNULL = open(os.devnull, 'w')
            retcode = subprocess.call(['./run_mcli.sh'], stdout=FNULL, stderr=subprocess.STDOUT)
            if retcode == 0:
                print "Setting RAID done"
                logger.info("Setting RAID done")
                spare_status = 1
            else:
                print "Setting RAID failed, please check physical drives status."
                logger.info("Setting RAID failed, please check physical drives status.")
                raid_status = -1
                spare_status = -1
            update_raid_config_file()
            return array_status, spare_status
def erase_raid(productname, storage_box):
    print "erase_raid"

def count_phydrv_A1100():
    phydrv = do_cmd("cliib -u admin -p password -C phydrv")
    #print phydrv
    file_ = open('/tmp/cnt_drv', 'w')
    file_.write("{}".format(phydrv))
    line_count = 0
    file_.close()
    with open('/tmp/cnt_drv') as infp:
        for line in infp:
           if line.strip():
              line_count += 1
    line_count = line_count-3
    logger.info("count_phydrv_A1100: {}".format(line_count))
    return line_count

def add_raid_raw():
    raids = list_raids()
    if A1100_PRODUCTNAME in productname:
        phdrv_count_A1100 = count_phydrv_A1100()
        if phdrv_count_A1100 ==16:
            print "16"       


def update_r_status_config_file(storage_box, array_status, spare_status):
    #return
    raids = list_raids()
    #return
    size_raid_conf = get_size_raid_conf()
    productname = get_productname()
    logger.info("raids: %s", raids)
    storage_box_existed = 0
    updated = 0
    c = 0
     
    if array_status == 1 and spare_status == 1:
        new_r_status = "Created"
    elif array_status == 2 and spare_status == 2:
        new_r_status = "Not Created"
    else:
        new_r_status = "Not Created"
    #return
    for n, i in enumerate(raids):
        for j, k in i.iteritems():
            #return #ok
            if k == storage_box:
                storage_box_existed = 1
                logger.info("k:%s ", k)
                #return #ok
                old_r_status = i["r_status"]
                #return #ok
                if old_r_status != new_r_status:
                    i["r_status"] = new_r_status
                    #return #ok
                    #print "Updated " + old_r_status + " to " + new_r_status
                    updated = 1
                    c = c + 1
                    logger.info("c: ")
                    logger.info(c)
                #return
    #return
    if not storage_box_existed:
        print "table raw is not enough, so run init?"
        init_raid_config_file(productname)
    if size_raid_conf <4:
        init_raid_config_file(productname)     
    if updated:
        logger.info("updated: %s", updated)
        file_ = open('/etc/ezs3/raid_conf', 'w')
        file_.write("{}".format(raids))
        file_.close()

def get_size_raid_conf():
    size_raid_conf = os.path.getsize(RAID_CONFIG)
    return size_raid_conf

#TODO: set created if in array is existed
def update_raid_config_file():
    logger.info("update_raid_config_file")
    if SIMULATION_MODE:
        return 0
    else:
        count_ok_array = do_cmd("cliib -u admin -p password -C array -a list |grep -E *'OK' |wc -l")
        count_ok_spare = do_cmd("cliib -u admin -p password -C spare -a list |grep -E *'OK' |wc -l")
        phdrv_count_A1100 = count_phydrv_A1100()
        logger.info("phdrv_count_A1100: %s", phdrv_count_A1100)
    if phdrv_count_A1100 ==16:
        if count_ok_array == "1\n" and count_ok_spare == "1\n":
            array_status = 1
            spare_status = 1
            update_r_status_config_file(HEAD, array_status, spare_status)
        else:
            array_status = 2
            spare_status = 2
            update_r_status_config_file(HEAD, array_status, spare_status)

            #print("RAID not existed")
            #do_cmd("cliib -u admin -p password -C array -a add -p1~15 -l\\\"raid=5\\\"")
            array_status = 1
    elif phdrv_count_A1100 ==32:
        if count_ok_array == "2\n" and count_ok_spare == "2\n":
            update_r_status_config_file(HEAD, 1, 1)
            update_r_status_config_file(JBOD1, 1, 1)
        elif count_ok_array == "1\n" and count_ok_spare == "1\n":
            update_r_status_config_file(HEAD, 1, 1)
            update_r_status_config_file(JBOD1, 2, 2)
        else:
            update_r_status_config_file(HEAD, 2, 2)
            update_r_status_config_file(JBOD1, 2, 2)

    elif phdrv_count_A1100 ==48:
        if count_ok_array == "3\n" and count_ok_spare == "3\n":
            update_r_status_config_file(HEAD, 1, 1)
            update_r_status_config_file(JBOD1, 1, 1)
            update_r_status_config_file(JBOD2, 1, 1)
        elif count_ok_array == "2\n" and count_ok_spare == "2\n":
            update_r_status_config_file(HEAD, 1, 1)
            update_r_status_config_file(JBOD1, 1, 1)
            update_r_status_config_file(JBOD2, 2, 2)
        elif count_ok_array == "1\n" and count_ok_spare == "1\n":
            update_r_status_config_file(HEAD, 1, 1)
            update_r_status_config_file(JBOD1, 2, 2)
            update_r_status_config_file(JBOD2, 2, 2)
        else:
            update_r_status_config_file(HEAD, 2, 2)
            update_r_status_config_file(JBOD1, 2, 2)
            update_r_status_config_file(JBOD2, 2, 2)
    elif phdrv_count_A1100 ==64:
        if count_ok_array == "4\n" and count_ok_spare == "4\n":
            update_r_status_config_file(HEAD, 1, 1)
            update_r_status_config_file(JBOD1, 1, 1)
            update_r_status_config_file(JBOD2, 1, 1)
            update_r_status_config_file(JBOD3, 1, 1)
        elif count_ok_array == "3\n" and count_ok_spare == "3\n":
            update_r_status_config_file(HEAD, 1, 1)
            update_r_status_config_file(JBOD1, 1, 1)
            update_r_status_config_file(JBOD2, 1, 1)
            update_r_status_config_file(JBOD3, 0, 0)
        elif count_ok_array == "2\n" and count_ok_spare == "2\n":
            update_r_status_config_file(HEAD, 1, 1)
            update_r_status_config_file(JBOD1, 1, 1)
            update_r_status_config_file(JBOD2, 2, 2)
            update_r_status_config_file(JBOD3, 2, 2)
        elif count_ok_array == "1\n" and count_ok_spare == "1\n":
            update_r_status_config_file(HEAD, 1, 1)
            update_r_status_config_file(JBOD1, 2, 2)
            update_r_status_config_file(JBOD2, 2, 2)
            update_r_status_config_file(JBOD3, 2, 2)
        else:
            update_r_status_config_file(HEAD, 2, 2)
            update_r_status_config_file(JBOD1, 2, 2)
            update_r_status_config_file(JBOD2, 2, 2)
            update_r_status_config_file(JBOD3, 2, 2)

@remote.callable
def create_raid2():
    raids = list_raids()
    for n, i in enumerate(raids):
        for j, k in i.iteritems():
            print "j: " + j
            print "k: " + k
            if k == "Not Created":
                i[j] = "Created"
    file_ = open('/etc/ezs3/raid_conf', 'w')
    file_.write("{}".format(raids))
    file_.close()

def get_productname():
    productNamePath = ("/tmp/productname")
    productnameFileExisted = os.path.isfile(productNamePath)
    if productnameFileExisted:
        productname = do_cmd("cat {}".format(productNamePath))
        productname = productname.rstrip()
    else:
        productname = do_cmd("/promise/bin/amidelnx/amidelnx_26_64 /SP | grep SP |grep \"R\"| sed \'s/.*Done   //\'| awk -F\'\"\' \'{print $2}\' ")
        productname = productname.rstrip()
        os.system("echo {} > {}".format(productname, productNamePath))
    return productname

