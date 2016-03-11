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

logger = EZLog.get_logger(__name__)
cl = get_central_logger()
ALIGNMENT_SECTORS = 2048
NAS_DISKS_CONF = "/etc/ezs3/nas_disks.conf"
NAS_MOUNT_POINT_PREFIX = "/mnt/nas/loop_"
MULTIPATH_CONF = "/etc/multipath.conf"
MEGACLI_BIN = '/opt/MegaRAID/MegaCli/MegaCli64'


@remote.callable
def list_raids():
    raids = []
    raidc = "15 + 1 RAID 5"
    status = "OK"
    description = "Header"
    description1 = "JBOD"
    
    raid1 = {'raidconfig': raidc, 'r_status': status, 'r_description': description}
    raid2 = {'raidconfig': raidc, 'r_status': status, 'r_description': description1}
    #raid = {'raidconfig': raidc, 'r_status': status, 'r_description': description}, {'raidconfig': raidc, 'r_status': status, 'r_description': description}
    raids.append(raid1)
    raids.append(raid2)
    return raids


class TooManyNASDisks(RuntimeError):
    pass


class NASMountFailed(RuntimeError):
    pass


class NASNotEnoughSpace(RuntimeError):
    pass


class NASSizeTooLarge(RuntimeError):
    pass


class ISCSIDiscoveryError(RuntimeError):
    def __init__(self, mesg):
        RuntimeError.__init__(self, mesg)


def get_root_dev():
    for dev in list_block_devices():
        if dev['root']:
            return dev['path']
    return ''


def size_readable_fmt(num):
    for x in ['bytes', 'KB', 'MB', 'GB']:
        if num < 1024.0 and num > -1024.0:
            return "%3.1f%s" % (num, x)
        num /= 1024.0
    return "%3.1f%s" % (num, 'TB')


@remote.callable
def get_disk_size(path):
    return long(do_cmd('blockdev --getsize64 {}'.format(path)))


@remote.callable
def get_disks_metrics():
    storage_ip = Ezs3CephConfig().get_storage_ip()
    cmm = ClusterMetricManager()
    all_rt_metrics = cmm.get_data(categories=['disk_realtime'])['disk_realtime']
    node = 'node.{}'.format(storage_ip)
    if all_rt_metrics.has_key(node):
        node_rt_metrics = all_rt_metrics[node].items()
    else:
        node_rt_metrics = {}

    metrics = {}
    for k, v in node_rt_metrics:
        if k == 'timestamp':
            continue
        else:
            metrics[k] = {
                'iops': int(v['read_count'] + v['write_count']),
                'kb_read': int(v['read_bytes']/1024),
                'kb_write': int(v['write_bytes']/1024),
            }
    return metrics


@remote.callable
def get_disks_multipath_offline():
    # The output of multipathd is not parsing friendly
    #
    # hcil    dev dev_t pri dm_st  chk_st dev_st  next_check
    # 2:0:3:0 sdd 8:48  1   undef  ready  running orphan
    # 4:0:0:0 sde 8:64  1   active ready  running XXX....... 6/20
    lines = do_cmd('multipathd show paths').splitlines()[1:]
    offline_devs = set()
    for line in lines:
        # hcil, dev, dev_t, pri, dm_st, chk_st, dev_st, next_check, _holder = line.split()
        cols = line.split()
        dev = cols[1]
        chk_st = cols[5]
        if chk_st == 'faulty':
            offline_devs.add(dev)
    return offline_devs


@remote.callable
def list_disks():
    root_dev = get_root_dev()
    output = do_cmd('lsscsi -t')
    disks = []
    for line in output.splitlines():
        fields = line.split()
        if len(fields) == 4:
            hctl, dev_type, transport, path = fields
        elif len(fields) == 3:
            hctl, dev_type, path = fields
            transport = ''
        else:
            logger.warn('Unable to parse lsscsi line: {}'.format(line))
            continue
        # hctl format [host:channel:target_number:lun]
        host, _, _, lun = hctl[1:-1].split(':')
        if dev_type == 'disk' and path != "-":
            try:
                disk = {'path': path, 'size': get_disk_size(path), 'host': host}
            except Exception:
                logger.warn('Unable to get size of {}, skip it.'.format(path))
            else:
                if root_dev == path:
                    disk['root'] = True
                if transport.startswith('iqn.'):
                    disk['type'] = 'iscsi'
                    disk['target'] = transport.split(',')[0]
                    disk['lun'] = int(lun)
                elif transport.startswith('fc:'):
                    disk['type'] = 'fc'
                    disk['target'] = re.match('fc:0x(.+)', transport.split(',')[0]).group(1)
                    disk['lun'] = int(lun)
                else:
                    disk['type'] = 'scsi'
                disks.append(disk)

    return disks


@remote.callable
def list_promise_info():
    overviews = []
    storage = []
    f = open("/var/www/VR2K_output_exam.json")
    json_data = f.read()
    data = json.loads(json_data)

    for key in data["overview"].keys():
        overview = {}
        overview["part"] = key
        overview["status"] = data["overview"][key]["status"]
        overviews.append(overview)

    server_overviews = []
    server_model = data["server"]["model"]  # ASUS server
    for key in data["server"]["overview"]:
        server_overview = {}
        server_overview["part"] = key
        server_overview["status"] = data["server"]["overview"][key]["status"]
        server_overviews.append(server_overview)

    server_ethernets = []
    for i in range(len(data["server"]["ethernet"])):
        server_ethernet = {}
        server_ethernet["interface"] = data["server"]["ethernet"][i]["interface"]
        server_ethernet["ip"] = data["server"]["ethernet"][i]["ip"]
        server_ethernet["switchmac"] = data["server"]["ethernet"][i]["switchmac"]
        server_ethernet["status"] = data["server"]["ethernet"][i]["status"]
        server_ethernets.append(server_ethernet)

    server_temps = []
    for i in range(len(data["server"]["temperature"])):
        server_temp = {}
        server_temp["id"] = data["server"]["temperature"][i]["id"]
        server_temp["location"] = data["server"]["temperature"][i]["location"]
        server_temp["value"] = data["server"]["temperature"][i]["value"]
        server_temp["status"] = data["server"]["temperature"][i]["status"]
        server_temps.append(server_temp)

    server_vols = []
    for i in range(len(data["server"]["temperature"])):
        server_vol = {}
        server_vol["id"] = data["server"]["voltage"][i]["id"]
        server_vol["location"] = data["server"]["voltage"][i]["location"]
        server_vol["value"] = data["server"]["voltage"][i]["value"]
        server_vol["status"] = data["server"]["voltage"][i]["status"]
        server_vols.append(server_vol)

    server_fans = []
    for i in range(len(data["server"]["fan"])):
        server_fan = {}
        server_fan["id"] = data["server"]["fan"][i]["id"]
        server_fan["location"] = data["server"]["fan"][i]["location"]
        server_fan["value"] = data["server"]["fan"][i]["value"]
        server_fan["status"] = data["server"]["fan"][i]["status"]
        server_fans.append(server_fan)

    server_psus = []
    for i in range(len(data["server"]["psu"])):
        server_psu = {}
        server_psu["id"] = data["server"]["psu"][i]["id"]
        server_psu["location"] = data["server"]["psu"][i]["location"]
        server_psu["value"] = data["server"]["psu"][i]["value"]
        server_psu["status"] = data["server"]["psu"][i]["status"]
        server_psus.append(server_psu)

    storages = []
    for i in range(len(data["storage"])):
        storage = {}
        storage["model"] = data["storage"][i]["model"]  # VESS2000-3U-16Bay
        storage["enc_id"] = data["storage"][i]["EnclosureId"]
        storage["wwn"] = data["storage"][i]["wwn"]

        storage_overview = []
        for key in data["storage"][i]["overview"].keys():
            entry = {}
            entry["part"] = key
            entry["status"] = data["storage"][i]["overview"][key]["status"]
            storage_overview.append(entry)
        storage["overview"] = storage_overview

        storage_saslink = []
        for j in range(len(data["storage"][i]["saslink"])):
            entry = {}
            entry["ctrlid"] = data["storage"][i]["saslink"][j]["ctrlid"]
            entry["port"] = data["storage"][i]["saslink"][j]["port"]
            entry["status"] = data["storage"][i]["saslink"][j]["status"]
            storage_saslink.append(entry)
        storage["sas_link"] = storage_saslink

        storage_disk = []
        for j in range(len(data["storage"][i]["disk"])):
            entry = {}
            entry["id"] = data["storage"][i]["disk"][j]["id"]
            entry["location"] = data["storage"][i]["disk"][j]["location"]
            entry["vendor"] = data["storage"][i]["disk"][j]["vendor"]
            entry["model"] = data["storage"][i]["disk"][j]["model"]
            entry["capacity"] = data["storage"][i]["disk"][j]["capacity"]
            entry["temp"] = data["storage"][i]["disk"][j]["temp"]
            entry["status"] = data["storage"][i]["disk"][j]["status"]
            storage_disk.append(entry)
        storage["disk"] = storage_disk

        storage_temp = []
        for j in range(len(data["storage"][i]["temperature"])):
            entry = {}
            entry["id"] = data["storage"][i]["temperature"][j]["id"]
            entry["location"] = data["storage"][i]["temperature"][j]["location"]
            entry["value"] = data["storage"][i]["temperature"][j]["value"]
            entry["status"] = data["storage"][i]["temperature"][j]["status"]
            storage_temp.append(entry)
        storage["temperature"] = storage_temp

        storage_vol = []
        for j in range(len(data["storage"][i]["voltage"])):
            entry = {}
            entry["id"] = data["storage"][i]["voltage"][j]["id"]
            entry["location"] = data["storage"][i]["voltage"][j]["location"]
            entry["value"] = data["storage"][i]["voltage"][j]["value"]
            entry["status"] = data["storage"][i]["voltage"][j]["status"]
            storage_vol.append(entry)
        storage["voltage"] = storage_vol

        storage_fan = []
        for j in range(len(data["storage"][i]["fan"])):
            entry = {}
            entry["id"] = data["storage"][i]["fan"][j]["id"]
            entry["location"] = data["storage"][i]["fan"][j]["location"]
            entry["value"] = data["storage"][i]["fan"][j]["value"]
            entry["status"] = data["storage"][i]["fan"][j]["status"]
            storage_fan.append(entry)
        storage["fan"] = storage_fan

        storage_psu = []
        for j in range(len(data["storage"][i]["psu"])):
            entry = {}
            entry["id"] = data["storage"][i]["psu"][j]["id"]
            entry["value"] = data["storage"][i]["psu"][j]["value"]
            entry["status"] = data["storage"][i]["psu"][j]["status"]
            storage_psu.append(entry)
        storage["psu"] = storage_psu

        storage_bbu = []
        if "bbu" not in data["storage"][i]:
            storages.append(storage)
            continue
        for j in range(len(data["storage"][i]["bbu"])):
            entry = {}
            entry["id"] = data["storage"][i]["bbu"][j]["id"]
            entry["temp"] = data["storage"][i]["bbu"][j]["temp"]
            entry["voltage"] = data["storage"][i]["bbu"][j]["voltage"]
            entry["remainingcapacity"] = data["storage"][i]["bbu"][j]["remainingcapacity"]
            entry["estimatedholdtime"] = data["storage"][i]["bbu"][j]["estimatedholdtime"]
            entry["status"] = data["storage"][i]["bbu"][j]["status"]
            storage_bbu.append(entry)
        storage["bbu"] = storage_bbu
        storages.append(storage)

    logger.info(storages)
    return server_model, overviews, server_overviews, server_ethernets, server_temps, server_vols, server_fans, server_psus, storages


@remote.callable
def list_enclosure_info():
    temps = []
    voltages = []
    rpms = []

    output = do_cmd("ipmitool -I open sensor")
    lines = output.splitlines()

    for i in range(len(lines)):
        temp = {}
        voltage = {}
        rpm = {}
        fields = lines[i].split("|")
        if fields[2].startswith(" degrees"):
            temp['name'] = 'Temperature Sensor'
            temp['id'] = fields[0].strip()
            temp['value'] = fields[1].strip()
            temp['status'] = fields[3].strip()
            temps.append(temp)
        elif fields[2].startswith(" RPM"):
            rpm['name'] = 'FAN Sensor'
            rpm['id'] = fields[0].strip()
            rpm['value'] = fields[1].strip()
            rpm['status'] = fields[3].strip()
            rpms.append(rpm)
        elif fields[2].startswith(" Volts"):
            voltage['name'] = 'Voltage Sensor'
            voltage['id'] = fields[0].strip()
            voltage['value'] = fields[1].strip()
            voltage['status'] = fields[3].strip()
            voltages.append(voltage)

    output = do_cmd("ipmitool sel list")
    lines = output.splitlines()
    ipmi_events = []
    for line in lines:
        event = {}
        fields = line.split('|')
        event['id'] = fields[0].strip()
        event['date'] = fields[1].strip() + " " + fields[2].strip()
        if not isTimeFormat(fields[2].strip()):
            continue
        event['log'] = fields[3] + fields[4]
        ipmi_events.append(event)

    try:
        sorted_ipmi_events = sorted(ipmi_events, key=lambda k: datetime.datetime.strptime(k['date'], '%m/%d/%Y %H:%M:%S'), reverse=True)
    except Exception as e:
        logger.error(e)
    return temps, voltages, rpms, sorted_ipmi_events


@remote.callable
def list_local_disks():
    disks = []
    output = do_cmd('lsscsi -l')
    lines = output.splitlines()
    for i in xrange(0, len(lines), 2):
        fields1 = lines[i].split()
        fields2 = lines[i+1].split()
        dev_type = fields1[1]
        smart_error = 0
        if dev_type != 'disk':
            continue
        transport = fields1[2]
        if transport.startswith('SCST'):
            continue
        name = fields1[-1]
        state = fields2[0].split('=')[1]
        local_disks = list_block_devices(True)
        local_found = False
        for disk in local_disks:
            if name == disk['path']:
                local_found = True
                break
        if not local_found:
            continue
        cmd = '/usr/sbin/smartctl -s on -a {}|grep Reallocated_Sector_Ct'.format(name)
        try:
            output = do_cmd(cmd)
            smart_error = output.split()[-1]
        except Exception:
            smart_error = 0

        try:
            disk = {'slot': '', 'name': name, 'state': "Online" if state == "running" else state, 'size': size_readable_fmt(get_disk_size(name)), 'error': ''}
        except Exception:
            logger.warn('Unable to get size of {}, skip it.'.format(name))
        else:
            disk['foreign'] = ''
            disk['dev_speed'] = ''
            disk['link_speed'] = ''
            disk['smart_error'] = "No" if smart_error == 0 else smart_error
            disks.append(disk)

    if os.path.exists(MEGACLI_BIN):
        output = do_cmd(MEGACLI_BIN + ' pdlist aAll|awk -f /usr/local/bin/summary.awk')
        for line in output.splitlines():
            fields = line.split('|')
            if fields[1] == 'ID':
                continue
            disk = {}
            disk['slot'] = fields[2]
            disk['name'] = fields[3]
            disk['size'] = fields[4]
            disk['state'] = fields[5].strip(',')
            disk['error'] = fields[6]
            disk['foreign'] = fields[7]
            disk['dev_speed'] = fields[8]
            disk['link_speed'] = fields[9]
            disk['smart_error'] = fields[10]
            disks.append(disk)
    return disks


# return persistent path even after reboot
def get_disk_persistent_path(path):
    if not is_disk_path(path):
        raise RuntimeError('Invalid disk path: {}'.format(path))

    path_by_id = ''
    path_dm_md = ''
    real_path = os.path.realpath(path)
    output = do_cmd('udevadm info --query=symlink --name={}'.format(real_path))
    for path in output.split():
        # output should be listed in alphabetical order,
        # so the same kind of devices should have common prefix
        # in their first path under /dev/disk/by-id/
        if path.startswith('disk/by-id/'):
            if not path_by_id:
                path_by_id = '/dev/{}'.format(path)
        elif path.startswith('md/') or path.startswith('mapper/'):
            path_dm_md = '/dev/{}'.format(path)

    # return path starts with /dev/mapper/ or /dev/md/ if possible,
    # because fstab doesn't support /dev/disk/by-id
    if path_dm_md:
        return path_dm_md
    elif path_by_id:
        return path_by_id
    else:
        # vmware disks have no persistent path, so we return real path directly
        return real_path


@remote.callable
def list_iscsi_disks():
    disks = []
    metrics = get_disks_metrics()
    offline_devs = get_disks_multipath_offline()
    for disk in list_block_devices():
        dev_name = disk['path'].split('/')[-1]
        if metrics.has_key(dev_name):
            disk['metrics'] = metrics[dev_name]
        else:
            continue
        if disk['type'] == 'mpath':
            if disk['slaves'][0]['type'] in ('iscsi', 'fc'):
                for slave in disk['slaves']:
                    if slave['path'].split('/')[-1] not in offline_devs:
                        disk['online'] = True
                        break
                else:
                    disk['online'] = False

                disks.append(disk)
        elif disk['type'] in ('iscsi', 'fc'):
            if not has_mpath_holder(disk):
                with open('/sys/block/{}/device/state'.format(dev_name)) as f:
                    disk['online'] = (f.read() == 'running\n')
                disks.append(disk)
    return disks


@remote.callable
def iscsi_login(target, ip, port=3260):
    logger.info('Login iscsi target={} ip={} port={}'.format(target, ip, port))
    try:
        do_cmd('iscsiadm -m discovery -t st -p {}:{}'.format(ip, port))
        if target:
            do_cmd(
                'iscsiadm -m node --login -T {} -p {}:{}'
                .format(target, ip, port)
            )
            do_cmd(
                'iscsiadm -m node -T {} -p {}:{} -o update -n node.startup -v automatic'
                .format(target, ip, port)
            )
        else:
            do_cmd(
                'iscsiadm -m node --login -p {}:{}'
                .format(ip, port)
            )
            do_cmd(
                'iscsiadm -m node -p {}:{} -o update -n node.startup -v automatic'
                .format(ip, port)
            )
        return True
    except DoCommandError as e:
        logger.error(e)
        return False


@remote.callable
def iscsi_logout(target='', ip='', port=3260):
    logger.info('Logout iscsi target={} ip={} port={}'.format(target, ip, port))
    try:
        if target:
            do_cmd(
                'iscsiadm -m node --logout -T {}'.format(target)
            )
            do_cmd(
                'iscsiadm -m node -T {} -o delete'.format(target)
            )
        else:
            do_cmd(
                'iscsiadm -m node --logout -p {}:{}'
                .format(ip, port)
            )
            do_cmd(
                'iscsiadm -m node -p {}:{} -o delete'
                .format(ip, port)
            )
        return True
    except DoCommandError as e:
        logger.error(e)
        return False


@remote.callable
def list_iscsi_sessions():
    sessions = []
    output = do_cmd('iscsiadm -m session')
    for line in output.splitlines():
        m = re.match(r'tcp: \[\d+\] (.+),\d+ (.+)', line)
        if m:
            sessions.append({'address': m.group(1), 'target': m.group(2)})
        else:
            logger.warn('Unable to parse session: {}'.format(line))
    return sessions


@remote.callable
def iscsi_discover(ip, port=3260):
    targets = []

    try:
        result = do_cmd('iscsiadm -m discovery -t st -p {}:{}'.format(ip, port))
    except Exception:
        raise ISCSIDiscoveryError("Cannot connect to iscsi at {}:{}".format(ip, port))

    lines = result.split("\n")
    for line in lines:
        if not line:
            continue
        target = line.split()[1].strip()
        if target:
            targets.append(target)
    return targets


@remote.callable
def has_fibre_channel():
    fc_str = "Fibre Channel to PCI Express HBA"
    lspci_output = do_cmd("lspci")
    if lspci_output.find(fc_str) >= 0:
        return True
    return False


@remote.callable
def find_fc_targets():
    targets = []
    if os.path.isdir(defaults.SCST_QLA2X00T_TGT_DIR):
        for target in list(os.listdir(defaults.SCST_QLA2X00T_TGT_DIR)):
            if os.path.isdir(os.path.join(defaults.SCST_QLA2X00T_TGT_DIR, target)):
                targets.append(target)
    return targets


@remote.callable
def find_fc_wwns():
    wwns = []
    try:
        output = do_cmd("cat /sys/class/fc_host/host*/port_name")
        for line in output.splitlines():
            wwn = ''
            sep_count = 2
            for c in line[2:]:
                wwn += c
                sep_count -= 1
                if sep_count == 0:
                    wwn += ':'
                    sep_count = 2
            wwns.append(wwn[:-1])
    except DoCommandError:
        logger.debug("No fc cards detected on this machine")
    return wwns


@remote.callable
def load_fc_target_module():
    logger.debug("load fc target module")
    do_cmd("modprobe qla2x00tgt")


@remote.callable
def unload_fc_target_module():
    logger.debug("unload fc target module")
    do_cmd("modprobe -r qla2x00tgt")


@remote.callable
def get_scsi_lun_name(dev):
    output = do_cmd('lsscsi')
    for line in output.splitlines():
        fields = line.split()
        if dev == fields[-1]:
            lun_name = ' '.join(fields[3:-2])
            return lun_name
    return None


@remote.callable
def get_srcdev(md_info):
    src_dev = md_info['src_dev']
    if md_info['type'] == 'iscsi':
        if md_info['src_wwid']:
            return get_scsi_dev(md_info['src_wwid'])
        else:
            return src_dev
    elif md_info['type'] == 'fc':
        return get_fc_dev(md_info['src_target'], md_info['src_lun'])

    return ''


@remote.callable
def get_fc_dev(target, lun):
    for dev in list_block_devices():
        if dev['type'] == 'mpath':
            for slave in dev['slaves']:
                if slave['type'] == 'fc' and slave['target'] == target and slave['lun'] == lun:
                    return dev['path']
        elif dev['type'] == 'fc' and dev['target'] == target and dev['lun'] == lun:
            if not has_mpath_holder(dev):
                return dev['path']
    return ''


@remote.callable
def get_scsi_dev(wwid):
    path = '/dev/disk/by-id/scsi-{}'.format(wwid)
    if os.path.exists(path):
        return os.path.realpath(path)
    return ''


def get_wwns():
    wwn_s = []
    for line in do_cmd('lsscsi').splitlines():
        if 'disk' in line and '/dev' in line:
            dev = line.split()[-1]
            try:
                wwn = do_cmd('/lib/udev/scsi_id --whitelist --replace-white {}'.format(dev)).strip()
                wwn_s.append(wwn)
            except DoCommandError:
                pass
                # Ignore Floppy and CD-ROM
                # [9:0:0:0]    disk    AMI      Virtual Floppy0  1.00  /dev/sdb
                # [10:0:0:0]   disk    AMI      Virtual HDISK0   1.00  /dev/sdq
    spio_wwn_s = []
    mpio_wwn_s = []
    for k, v in collections.Counter(wwn_s).items():
        if v > 1:
            mpio_wwn_s.append(k)
        else:
            spio_wwn_s.append(k)
    return {'mpio': mpio_wwn_s, 'spio': spio_wwn_s}


def multipath_conf_blacklist_spio():
    f = open(MULTIPATH_CONF, 'r')
    config = f.read()
    f.close()

    section_head = 'blacklist {\n'
    before_index = config.index(section_head)
    after_index = config.index('}', before_index)
    before = config[:before_index]
    after = config[after_index:]

    section = 'devnode "^(rbd)[0-9]*"\n'
    for wwn in get_wwns()['spio']:
        section += '        wwn "{}"\n'.format(wwn)

    new_config = before + section_head + section + after

    f = open(MULTIPATH_CONF, 'w')
    f.write(new_config)
    f.close()


def multipath_conf_whitelist_mpio():
    f = open(MULTIPATH_CONF, 'r')
    config = f.read()
    f.close()

    section_head = 'blacklist_exceptions {\n'
    before_index = config.index(section_head)
    after_index = config.index('}', before_index)
    before = config[:before_index]
    after = config[after_index:]

    section = ''
    for wwn in get_wwns()['mpio']:
        section += '        wwn "{}"\n'.format(wwn)

    new_config = before + section_head + section + after

    f = open(MULTIPATH_CONF, 'w')
    f.write(new_config)
    f.close()


def save_nas_disks_conf(disks):
    conf = {"version": 1, "disks": disks}
    with open(NAS_DISKS_CONF, "w") as f:
        json.dump(conf, f)


def load_nas_disks_conf():
    if os.path.exists(NAS_DISKS_CONF):
        with open(NAS_DISKS_CONF, "r+") as f:
            conf = json.load(f)
            if "version" not in conf:
                for d in conf.values():
                    d["image"] = "vdisk.img"
                new_conf = {"version": 1, "disks": conf}
                f.seek(0)
                f.truncate(0)
                json.dump(new_conf, f)
                return new_conf
            elif conf["version"] > 1:
                raise RuntimeError("unknown nas disk config format")
            else:
                return conf
    else:
        return {"version": 1, "disks": {}}


@remote.callable
def get_nas_disks():
    conf = load_nas_disks_conf()
    return conf["disks"]


@remote.callable
def create_nas_disk(nas_type, server, path, size, username="", password=""):
    storage_ip = Ezs3CephConfig().get_storage_ip()
    try:
        idx = _create_nas_disk(nas_type, server, path, size, username, password)
        cl.node_management.nas_disk_created(node_ip=storage_ip, devpath="/dev/loop{}".format(idx))
    except Exception as e:
        cl.node_management.nas_disk_create_failed(node_ip=storage_ip, _detail=str(e))
        raise e


def _create_nas_disk(nas_type, server, path, size, username="", password=""):
    update_task_info(
        TASK_TICKET.CREATE_NAS_DISK,
        {
            "progress": 0,
            "type": nas_type,
            "server": server,
            "path": path,
            "size": size,
            "devpath": ""
        }
    )
    with ProcessLock(FILE_RESOURCE.NAS_DISK_CONF):
        disks = get_nas_disks()

        # allocate ID
        i = 0
        MAX_ID = 8
        while i < MAX_ID:
            if str(i) not in disks.keys():
                break
            i += 1
        if i == 8:
            raise TooManyNASDisks("too many disks: suppports up to 8")

        update_task_info(TASK_TICKET.CREATE_NAS_DISK, {"progress": 10, "idx": i})

        # mount NAS share
        sharepoint = ""
        moption = ""
        mountpoint = "{}{}".format(NAS_MOUNT_POINT_PREFIX, i)
        if not os.path.exists(mountpoint):
            os.makedirs(mountpoint)

        if nas_type == "nfs":
            sharepoint = u"{}:{}".format(server, path)
            moption = {"rw": None, "soft": None, "timeo": "33", "retry": "1"}
        elif nas_type == "cifs":
            sharepoint = u"//{}/{}".format(server, path)
            do_cmd(
                "echo 'username={}\npassword={}' > /root/.smb{}; "
                "chmod 600 /root/.smb{}".format(
                    username, password, i, i
                )
            )
            moption = {"credentials": "/root/.smb{}".format(i),
                       "iocharset": "utf8"}
        try:
            mount_fs(nas_type, moption, sharepoint, mountpoint)
        except Exception as e:
            raise NASMountFailed(str(e))

        update_task_info(TASK_TICKET.CREATE_NAS_DISK, {"progress": 20})

        # create disk image on NAS
        try:
            fsinfo = os.statvfs(mountpoint)
            avail_size = fsinfo.f_bsize * fsinfo.f_bavail
            size = int(size)
            if size > avail_size:
                raise NASNotEnoughSpace(
                    "space not enough: "
                    "requested size {} > free {}".format(size, avail_size)
                )

            seq = 0
            vdisk_path = ""
            while True:
                vdisk_path = "{}/vdisk{}.img".format(mountpoint, seq)
                if not os.path.exists(vdisk_path):
                    break
                seq += 1

            try:
                do_cmd("truncate -s {} {}".format(size, vdisk_path))
            except Exception:
                raise NASSizeTooLarge("requested size not supported: {}".format(size))

            # cifs does not support sparse file well, so dd the image first
            if nas_type == 'cifs':
                bs_size = 32 << 20
                dd_count = int(math.ceil(size * 1.0 / bs_size))

                def callback(p):
                    out_str = ''
                    err_str = ''
                    # don't know why but p.send_signal will kill the process, so use "kill" instead.
                    do_cmd('kill -10 {}'.format(p.pid))
                    while True:
                        out_str += p.stdout.readline()
                        err_line = p.stderr.readline()
                        err_str += err_line
                        # dd fails, no wait
                        if err_line.startswith('dd:'):
                            return out_str, err_str
                        # report progress, wait
                        if 'bytes' in err_line:
                            transfered_size = int(err_line.split()[0])
                            dd_progress = transfered_size * (80 - 20) / size
                            update_task_info(TASK_TICKET.CREATE_NAS_DISK, {"progress": 20 + dd_progress})
                            time.sleep(1)
                            return out_str, err_str

                do_cmd_with_progress("dd if=/dev/zero of={} bs={} count={}".format(vdisk_path, bs_size, dd_count), callback)

            do_cmd("truncate -s {} {}".format(size, vdisk_path))

            update_task_info(TASK_TICKET.CREATE_NAS_DISK, {"progress": 80})

            # connect loop device
            do_cmd("losetup /dev/loop{} {}".format(i, vdisk_path))
            do_cmd("partx -a /dev/loop{}".format(i))

            update_task_info(TASK_TICKET.CREATE_NAS_DISK, {"progress": 90})

            disks[i] = {
                "nas_type": nas_type,
                "server": server,
                "path": path,
                "username": username,
                "password": password,
                "size": size,
                "image": "vdisk{}.img".format(seq)
            }
            save_nas_disks_conf(disks)

            update_task_info(TASK_TICKET.CREATE_NAS_DISK, {"progress": 100})
            return i
        except Exception as e:
            do_cmd("umount -f '{}'".format(mountpoint))
            raise e


@remote.callable
def destroy_nas_disk(i):
    with ProcessLock(FILE_RESOURCE.NAS_DISK_CONF):
        disks = get_nas_disks()
        mountpoint = "{}{}".format(NAS_MOUNT_POINT_PREFIX, i)

        # disconnect loop device
        do_cmd("partx -d /dev/loop{}".format(i), force=True)
        do_cmd("losetup -d /dev/loop{}".format(i), force=True)

        # umount NAS
        do_cmd(
            "rm -f {}/{}".format(mountpoint, disks[i]["image"]),
            timeout=10, force=True
        )
        do_cmd("umount -f {}".format(mountpoint), timeout=10, force=True)
        do_cmd("umount -l {}".format(mountpoint), force=True)
        do_cmd("rm -f /root/.smb{}".format(i), force=True)

        # update conf
        del disks[i]
        save_nas_disks_conf(disks)


@remote.callable
def scan_scsi_device(scsi_host_name):
    scan_file = os.path.join("/sys/class/scsi_host", scsi_host_name, "scan")
    with open(scan_file, "w") as f:
        f.write("- - -")


@remote.callable
def rescan_all():
    for host in os.listdir("/sys/class/scsi_host"):
        try:
            scan_scsi_device(host)
        except Exception as ex:
            logger.warning("Failed to rescan scsi host %s: %s", host, ex.message)


def remove_disks(disks):
    for disk_path in disks:
        disk_name = str(disk_path).split("/")[-1]
        with open(os.path.join("/sys/block", disk_name, "device/delete"), "w") as f:
            f.write("1")


# make continuous partitions from head to the end on a parted device
def make_disk_partitions(device, sectors_list=()):
    if device.path.startswith('/dev/loop'):
        return make_disk_partitions_pyparted(device, sectors_list)
    else:
        return make_disk_partitions_gdisk(device, sectors_list)


def make_disk_partitions_gdisk(device, sectors_list=()):
    device_path = device.path
    # clear device mapper table
    if is_mpio_disk_path(device_path):
        do_cmd('kpartx -s -d {}'.format(device_path))
        do_cmd('kpartx -s -d -p -part {}'.format(device_path))

    # clear partition table on disk
    try:
        do_cmd('sgdisk -Z {}'.format(device_path))
        do_cmd('udevadm settle', force=True)
    except Exception:
        logger.exception('Unable to delete all partitions on {}'.format(device_path))

    # create partitions
    part_num = 1
    new_args = ''
    for sectors in sectors_list:
        if part_num == 1:
            new_args += ' -n 1:{}:+{}'.format(ALIGNMENT_SECTORS, sectors)
        else:
            new_args += ' -n {}:+0:+{}'.format(part_num, sectors)
        part_num += 1
    new_args += ' -N {}'.format(part_num)

    do_cmd('sgdisk {} {}'.format(device_path, new_args))

    # make sure all partition paths/links are correctly created
    do_cmd('udevadm settle', force=True)

    return parted.Disk(parted.Device(device_path)).partitions


def make_disk_partitions_pyparted(device, sectors_list=()):
    try:
        disk = parted.Disk(device)
        disk.deleteAllPartitions()
        disk.commit()
        if is_mpio_parted_device(device):
            mpio_partprobe(device)
        do_cmd('udevadm settle', force=True)
    except Exception:
        logger.exception('Unable to delete all partitions on {}'.format(device.path))

    start_offset = ALIGNMENT_SECTORS
    partitions = []
    disk = parted.freshDisk(device, _ped.disk_type_get("gpt"))
    constraint = parted.Constraint(device=device)
    for sectors in sectors_list:
        geo = parted.Geometry(device=device, start=start_offset, length=sectors)
        start_offset += sectors
        partition = parted.Partition(disk=disk,
                                     type=parted.PARTITION_NORMAL,
                                     geometry=geo)
        partitions.append(partition)
        disk.addPartition(partition, constraint=constraint)

    geo = parted.Geometry(device=device, start=start_offset, length=device.getLength()-start_offset)
    partition = parted.Partition(disk=disk,
                                 type=parted.PARTITION_NORMAL,
                                 geometry=geo)
    partitions.append(partition)
    disk.addPartition(partition, constraint=constraint)

    disk.commit()
    if is_mpio_parted_device(device):
        mpio_partprobe(device)

    # make sure all partition paths/links are correctly created
    do_cmd('udevadm settle', force=True)

    return partitions


def set_partition_label(device, number, label):
    """
    gdisk use ioctl(BLKRRPART,...), if one of partition on same disk
        are used by other device mapper, gdisk won't work
    """
    if device.startswith('/dev/dm-') or device.startswith('/dev/mapper/'):
        do_cmd("sgdisk {} -c {}:{}".format(device, number, label))
    else:
        do_cmd("parted {} name {} {}".format(device, number, label))


def clear_partition_label(device, number):
    if device.startswith('/dev/dm-') or device.startswith('/dev/mapper/'):
        do_cmd("sgdisk {} -c {}:''".format(device, number))
    else:
        do_cmd("yes '\"\"' | parted {} name {} ''".format(device, number))


def is_disk_path(path):
    realpath = os.path.realpath(path)
    name = os.path.basename(realpath)
    return os.path.isdir('/sys/block/{}'.format(name))


def is_disk(parted_dev):
    return isinstance(parted_dev, parted.Device)


def is_disk_capable(parted_dev, sectors=0):
    if parted_dev.getLength() < ALIGNMENT_SECTORS + sectors:
        logger.warn('Disk {} sectors too small'.format(parted_dev.path))
        return False
    return True


def is_flashcache(path):
    dm_name = path[len('/dev/mapper/'):]
    targets = do_cmd('dmsetup ls --target flashcache').split()
    return dm_name in targets


def is_partition_capable(parted_partition, size=0):
    if parted_partition.getSize() < size:
        logger.warn('Partition {} size too small'.format(parted_partition.path))
        return False
    return True


def is_mpio_disk_path(path):
    symlinks = do_cmd("udevadm info --query=symlink --name={}".format(path)).strip().split()
    for s in symlinks:
        if 'dm-uuid-mpath-' in s:
            # disk/by-id/dm-uuid-mpath-36001405fe405090352840f5bd75b6d4d
            return True
    else:
        return False


def is_mpio_partition_path(path):
    symlinks = do_cmd("udevadm info --query=symlink --name={}".format(path)).strip().split()
    for s in symlinks:
        if 'dm-uuid-part' in s and '-mpath-' in s:
            # disk/by-id/dm-uuid-part2-mpath-36001405fe405090352840f5bd75b6d4d
            return True
    else:
        return False


def is_mpio_parted_device(device):
    if is_disk(device):
        path = device.path
    elif type(device) is str:
        path = device

    # Way of lsblk
    real_name = os.path.basename(os.path.realpath(path))

    dm_uuid_path = '/sys/block/{}/dm/uuid'.format(real_name)
    if not os.path.isfile(dm_uuid_path):
        return False
    dm_uuid = open(dm_uuid_path, 'r').read()
    return dm_uuid.startswith('mpath')


def mpio_get_path(self):
    """Override ped.partition.Partition.path property"""
    if self.disk.device.type == parted.DEVICE_DM:
        return '{}-part{}'.format(self.disk.device.path, self.number)
    elif self.disk.device.type == 17L:  # DEVICE_MD
        return '{}p{}'.format(self.disk.device.path, self.number)
    else:
        return self._Partition__partition.get_path()


def mpio_partprobe(device):
    if is_disk(device):
        path = device.path
    elif type(device) is str:
        path = device

    path = get_disk_persistent_path(path)

    disk_dm_name = path[len('/dev/mapper/'):]

    """ HACKS:
    This seems a RHEL/Debian naming convetion difference

    With disk
    /dev/mapper/360014052141148ebfc848f4b74b7f749

    multlpath-tools create
    /dev/mapper/360014052141148ebfc848f4b74b7f749-part?
        which IS persistent across reboot
    parted create
    /dev/mapper/360014052141148ebfc848f4b74b7f749?
    /dev/mapper/360014052141148ebfc848f4b74b7f749p?
        which NOT persistent across reboot,

    also parted created ones will cause problem in next udev trigger, lets
    kill it!
    """
    on_disk_parts = []
    for p in do_cmd('kpartx -l -p -part {}'.format(path)).splitlines():
        # Format
        # 3600140506156b93edb94e72971f81102-part2 : 0 25163743 /dev/dm-4 8390656
        on_disk_parts.append(p.split()[0])
    # God's Way
    for p in glob.glob('/dev/mapper/{}-part*'.format(disk_dm_name)):
        part_dm_name = p[len('/dev/mapper/'):]
        if part_dm_name not in on_disk_parts:
            do_cmd('dmsetup remove {}'.format(part_dm_name))
    # garbage drop by parted
    for p in glob.glob('/dev/mapper/{}?'.format(disk_dm_name)):
        part_dm_name = p[len('/dev/mapper/'):]
        if part_dm_name not in on_disk_parts:
            do_cmd('dmsetup remove {}'.format(part_dm_name))
    # garbage drop by parted
    for p in glob.glob('/dev/mapper/{}p?'.format(disk_dm_name)):
        part_dm_name = p[len('/dev/mapper/'):]
        if part_dm_name not in on_disk_parts:
            do_cmd('dmsetup remove {}'.format(part_dm_name))

    do_cmd('kpartx -s -a -p -part {}'.format(path))


def mpio_dm_name_in_use():
    dm_in_use = set()
    dm_names = do_cmd('dmsetup ls --target multipath | cut -f 1').split('\n')

    # Find dm which are in use
    for dm_name in dm_names:
        real_dm_name = os.path.basename(
            os.path.realpath('/dev/mapper/{}'.format(dm_name)))
        holders = glob.glob('/sys/block/{}/holders/*'.format(real_dm_name))
        for holder in holders:
            real_dm_part_name = os.path.basename(holder)
            real_dm_part_path = '/dev/{}'.format(real_dm_part_name)
            # is mounted
            try:
                test_fd = None
                test_fd = os.open(real_dm_part_path, os.O_EXCL)
            except OSError, e:
                if e.errno == errno.EBUSY:
                    dm_in_use.add(dm_name)
            finally:
                if test_fd:
                    os.close(test_fd)
            # is opened
            if os.system('lsof {}'.format(real_dm_part_path)) == 0:
                dm_in_use.add(dm_name)

    return dm_in_use


@remote.callable
def mpio_partprobe_all(quick=False):

    using = mpio_dm_name_in_use()
    dm_names = do_cmd('dmsetup ls --target multipath | cut -f 1').strip().split('\n')
    if (dm_names == ['No devices found'] or
                dm_names == ['']): # Has flashcache
        do_cmd('partprobe')
        return

    for dm_name in dm_names:
        if dm_name not in using:
            if quick:
                do_cmd('kpartx -d -p -part /dev/mapper/{}'.format(dm_name))
                do_cmd('kpartx -a -p -part /dev/mapper/{}'.format(dm_name))
            else:
                mpio_partprobe('/dev/mapper/{}'.format(dm_name))


def isTimeFormat(input):
    try:
        time.strptime(input, '%H:%M:%S')
        return True
    except ValueError:
        return False


# return an unused md device's name with 5 random lowercases
def get_random_md_name():
    from ezs3.utils import gen_random_string
    used_names = []
    for path in glob.glob('/dev/md/*'):
        used_names.append(os.path.basename(path).split(':')[-1])
    md_name = gen_random_string(5)
    while md_name in used_names:
        md_name = gen_random_string(5)
    return md_name


def try_read_disk(dev_path):
    do_cmd(
        "dd if={} of=/dev/null bs=512 count=1 iflag=direct".format(dev_path),
        timeout=10
    )


def get_parted_disk_info(dev_path):
    disk_info = {}
    disk_info['partitions'] = []
    root_part = get_root_partition()
    try:
        # Test if disk is readable before using parted.getDevice() because
        # in some error case, eg. disk disconnected, parted.getDevice()
        # may hang forever
        try_read_disk(dev_path)
        dev = parted.getDevice(dev_path)
        disk_info['model'] = dev.model
        parts_info = []
        pdisk = parted.Disk(dev)
        for p in pdisk.partitions:
            if p.type not in [parted.PARTITION_NORMAL,
                              parted.PARTITION_LOGICAL]:
                continue
            # only append existing partitions
            if os.path.exists(str(p.path)):
                part_info = {'number': p.number}
                part_info['size_mb'] = int(p.getSize())
                part_info['path'] = str(p.path)
                part_info['root'] = (root_part == os.path.realpath(part_info['path']))
                parts_info.append(part_info)
        disk_info['partitions'] = parts_info
    except _ped.DiskLabelException:
        logger.debug('Unrecognised disk label for {}'.format(dev_path))
    except Exception:
        logger.exception('Unable to get partitions from disk {}'.format(dev_path))

    if 'model' not in disk_info:
        disk_info['model'] = ""
    return disk_info


def get_udev_info(dev_name):
    udev_info = {}
    output = do_cmd('udevadm info --query=property --name={}'.format(dev_name))
    for line in output.splitlines():
        dev_attr, dev_value = line.split('=')
        udev_info[dev_attr] = dev_value
    return udev_info


def get_udev_disk_info(dev_name):
    disk_info = {}
    udev_info = get_udev_info(dev_name)
    id_path = udev_info.get('ID_PATH')
    if id_path:
        m = re.match('(pci)-(.+)-(scsi)-(.+)', id_path)
        if not m:
            m = re.match('(ip)-(.+)-(iscsi)-(.+)-lun-(.+)', id_path)
        if not m:
            m = re.match('(pci)-(.+)-(fc)-(.+)-lun-(.+)', id_path)
        if not m:
            m = re.match('(pci)-(.+)-(sas)-(.+)-lun-(.+)', id_path)
        if m:
            disk_info['interface'] = m.group(1)
            disk_info['address'] = m.group(2)
            # overwrite disk type with more specific one
            # e.g. disk --> scsi/iscsi/fc/sas
            disk_info['type'] = m.group(3)
            disk_info['target'] = m.group(4)
            if m.lastindex == 5:
                disk_info['lun'] = m.group(5)

    # for backward compatability with SAN migration
    if udev_info.get('ID_SERIAL'):
        disk_info['wwid'] = udev_info['ID_SERIAL']
    if disk_info.get('interface') == 'ip':
        disk_info['ip'], disk_info['port'] = disk_info['address'].split(':')

    # for multipath device
    if udev_info.get('ID_MODEL'):
        disk_info['model'] = udev_info['ID_MODEL']
    if udev_info.get('ID_VENDOR'):
        disk_info['vendor'] = udev_info['ID_VENDOR']

    return disk_info


def get_root_partition():
    root_part = do_cmd("df /").splitlines()[1].split()[0]
    return os.path.realpath(root_part)


def get_slaves_info(dev_name):
    slaves = []
    for path in glob.glob('/sys/block/{}/slaves/*'.format(dev_name)):
        slave_path = '/dev/{}'.format(os.path.basename(path))
        if os.path.exists(slave_path):
            slave_info = get_udev_disk_info(slave_path)
            slave_info['path'] = slave_path
            slaves.append(slave_info)
    return slaves


def get_holders_info(dev_name):
    holders = []
    for path in glob.glob('/sys/block/{}/holders/*'.format(dev_name)):
        holder_name = os.path.basename(path)
        holder_path = '/dev/{}'.format(holder_name)

        # guess holder type by its name, hope it works
        holder_type = 'unknown'
        if holder_name.startswith('dm'):
            holder_type = 'mpath'
        elif holder_name.startswith('md'):
            holder_type = 'raid'

        holder_info = {'path': holder_path, 'type': holder_type}
        holders.append(holder_info)
    return holders


def is_dm_device(path):
    return path.startswith("/dev/dm")

def get_unusable_block_dev_major_numbers():
    # Ref: linux-kernel/Documentation/devices.txt
    # 1: ram disk
    # 2: floppy disk
    # 11: SCSI CD-ROM
    dev_majors = ['1', '2', '11']

    # rbd major number is dynamically assigned by kernel
    # we need to check /proc/devices to get the right number
    with open('/proc/devices') as f:
        reading_block_devs = False
        for line in f:
            if line.startswith('Block devices'):
                reading_block_devs = True
            elif reading_block_devs:
                dev_major, dev_type = line.split()
                if dev_type == 'rbd':
                    dev_majors.append(dev_major)

    return dev_majors


@remote.callable
def list_block_devices(internal_only=False):
    with ProcessLock(FILE_RESOURCE.LSBLK):
        cache = LocalCache(Ezs3CephConfig().get_storage_ip())
        key = 'lsblk_internal_only' if internal_only else 'lsblk'
        output = cache.get(key)
        if not output:
            output = _list_block_devices(internal_only)
            cache.set(key, output, 5)
        return output


# an ultimate helper function to get all block device information
# - list all block devices by lsblk
# - get disk information by udevadm
# - get partition information by parted
def _list_block_devices(internal_only=False):
    block_devs = []
    unusable_dev_majors = get_unusable_block_dev_major_numbers()
    output = do_cmd('lsblk -n -b -o KNAME,TYPE,MAJ:MIN,SIZE,LOG-SEC -e {}'.format(
                    ','.join(unusable_dev_majors)))

    dev_name_set = set([])
    for line in output.splitlines():
        dev_name, dev_type, dev_major_minor,size, sector_size = line.split()
        if dev_name in dev_name_set:
            continue
        dev_name_set.add(dev_name)

        if dev_type not in ('part', 'dm', 'md'):
            if os.path.isdir('/sys/block/{}'.format(dev_name)):
                dev_path = '/dev/{}'.format(dev_name)
                dev_info = {
                    'path': dev_path,
                    'major_minor': dev_major_minor,
                    'type': dev_type,
                    'size': int(size),
                    'size_mb': int(size) >> 20,
                    'persistent_path': get_disk_persistent_path(dev_path),
                    'sector_size': int(sector_size)
                }
                dev_info.update(get_udev_disk_info(dev_name))
                # dev_info['type'] has been updated by udev_disk_info
                dev_type = dev_info['type']

                if dev_type == 'mpath' or dev_type.startswith('raid'):
                    dev_info['slaves'] = get_slaves_info(dev_name)
                else:
                    holders_info = get_holders_info(dev_name)
                    if holders_info:
                        dev_info['holders'] = holders_info

                if dev_type == 'mpath':
                    # only using persistent path can retrieve correct parted info
                    # of a MPIO device, so we change partitions paths to real paths
                    # after updating with parted info
                    dev_info.update(get_parted_disk_info(dev_info['persistent_path']))
                    for part in dev_info['partitions']:
                        part['path'] = os.path.realpath(part['path'])
                else:
                    dev_info.update(get_parted_disk_info(dev_path))

                dev_info['root'] = False
                for part in dev_info['partitions']:
                    if part['root']:
                        dev_info['root'] = True

                if internal_only:
                    if dev_type == 'iscsi' or dev_type == 'fc' or dev_type == 'loop':
                        continue
                    if dev_type == 'mpath':
                        if dev_info['slaves'][0]['type'] == 'iscsi' or dev_info['slaves'][0]['type'] == 'fc':
                            continue
                    # it's hard to decide if a MD device is external or internal,
                    # so we don't check MD devices here

                block_devs.append(dev_info)
    return block_devs


@remote.callable
def get_block_device(dev_path):
    for dev in list_block_devices():
        if get_disk_persistent_path(dev_path) == dev['persistent_path']:
            return dev
    raise RuntimeError('Unable to find block device {}'.format(dev_path))


# the input dev must be from get_block_device/list_block_device
def has_mpath_holder(dev):
    if 'holders' in dev:
        for holder in dev['holders']:
            if holder['type'] == 'mpath':
                return True
    return False


# cleanup udev events and wait until dev path exists
def wait_path_created_by_udev(path, timeout=5):
    # run udevadm settle to cleanup udev events
    do_cmd('udevadm settle', force=True)
    # check and wait file existence in case
    # - the event is inserted after udevadm settle
    # - all udev processes are busy and unable to execute the event
    while timeout > 0 and not os.path.exists(path):
        time.sleep(0.1)
        timeout -= 0.1
    if not os.path.exists(path):
        raise RuntimeError('Unable to wait udev path {} being created, please check environment'.format(path))


def get_disk_name_from_dev_name(path):
    real_path = os.path.realpath(path)
    for dev in list_block_devices():
        if dev['path'] == real_path:
            return os.path.basename(dev['path'])
        else:
            for partition in dev['partitions']:
                if partition['path'] == real_path:
                    return os.path.basename(dev['path'])
    logger.warning('Unable to find the disk name of {}'.format(path))
    return os.path.basename(real_path)


def get_disk_info_from_partition(path):
    disk_name = get_disk_name_from_dev_name(path)
    vendor = ""
    model = ""
    try:
        with open("/sys/block/{}/device/vendor".format(disk_name)) as f:
            vendor = f.read().rstrip()
        with open("/sys/block/{}/device/model".format(disk_name)) as f:
            model = f.read().rstrip()
    except Exception as e:
        logger.error("get_disk_info_from_partition: {}".format(str(e)))

    return {"dev_name": disk_name, "vendor": vendor, "model": model}

@remote.callable
def get_physical_disks_status():
    slot_num = []
    cmd = MEGACLI_BIN + ' -PDList  -aALL |grep \"Slot Number\"'
    try:
        output = do_cmd(cmd)
        slots = output.strip().split("\n")
        # parse the line Slot Number: 1
        for slot in slots:
            slot_num.append(int(slot[slot.find(':')+2:]))
    except:  # This might not be an appliance
        return None

    return slot_num

def disk_by_id_to_dm_name(disk):
    """

    :param id: '/dev/disk/by-id/scsi-35000c5004d10e3b4' | 'scsi-35000c5004d10e3b4'
    :return: '35000c5004d10e3b4'
    """
    if disk.startswith('/dev/disk/by-id'):
        disk_path = disk
    else:
        disk_path = os.path.realpath('/dev/disk/by-id/{}'.format(disk))
    dm_real_path = os.path.realpath(disk_path)
    dm_basename = os.path.basename(dm_real_path)
    dm_name = open('/sys/block/{}/dm/name'.format(dm_basename)).read().strip()
    return dm_name


parted.partition.Partition.path = property(mpio_get_path)

class DeviceIdentifier:
    def __init__(self, alias_prefix='DEVICE'):
        self._block_devices = list_block_devices()
        for index, device in enumerate(self._block_devices):
            alias_name = '{}-{}'.format(alias_prefix, index)
            device['alias_name'] = alias_name

    def export_alias_mapping(self):
        mapping = {}
        for device in self._block_devices:
            info = {'address': device['address'], 'target': device['target']}
            mapping[device['alias_name']] = info
        return mapping

    def export_partition_layout(self):
        layout_list = {}
        layout_mapping = {}

        for index, device in enumerate(self._block_devices):
            # We cannot create partition on root device...
            if device['root'] == True:
                continue
            layout_name = 'layout-{}'.format(index)
            layout = {}
            for partition in device['partitions']:
                layout[str(partition['number'])] = {'size':'{}M'.format(partition['size_mb'])}
            layout_list[layout_name] = layout
            layout_mapping[device['alias_name']] = layout_name

        return layout_list, layout_mapping

    def get_alias_name_by_path(self, path):
        for device in self._block_devices:
            if device['path'] == path:
                return device['alias_name']
            if path.startswith(device['path']):
                for partition in device['partitions']:
                    if partition['path'] == path:
                        return '{}/{}'.format(device['alias_name'], partition['number'])
        return None

    def get_alias_name_by_md(self, md_name):
        pass
