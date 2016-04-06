import traceback
import web
import ezs3.utils
import ezs3.config
from ezs3.cluster import ClusterManager, IfaceRoleChangeInUse, IfaceRoleNotDefined
from ezs3.log import EZLog
from ezs3.node_management import prepare_enable_osd, enable_osd
from ezs3.remote import TASK_TICKET, ASYNC_MODE
import errors
from ezs3.raidutils import list_raids
from ezs3.raidutils import create_raids
from ezs3.raidutils import *

logger = EZLog.get_logger(__name__)

class Handler:
    #def POST(self):
    def GET(self):
        form = web.input()
        #print form
        #file_ = open('/tmp/form', 'w')
        #file_.write("{}".format(form))
        #file_.close()

        #logger.info("form: " + form)
        storage_box = form.get('storage_box[]', '')
        #file_ = open('/tmp/storage_box', 'w')
        #file_.write("{}".format(storage_box))
        #file_.close()

        #logger.info("create_raid.py: storage_box: %s ",  storage_box)
        #c_raid1, c_raid2 = create_raids(storage_box)
        create_raids(storage_box)
        #logger.info("c_raid1: %s, c_raid2 %s", c_raid1, c_raid2 )
        #logger.info("errors.SUCCESS: %s", errors.SUCCESS )
        
        return errors.SUCCESS
        #ip = form.get('ip')
        #cluster_if = form.get('cluster_iface', '')
        #public_if = form.get('public_iface', '')
        #svs = form.get('sv_list').split()

        #if not svs:
        #    return errors.HOST.NO_SV_ERROR   # no volume specified

        #try:
            #cluster_ip = ezs3.config.Ezs3CephConfig().get_storage_ip()
            #prepare_enable_osd(cluster_if, public_if, svs, _host=ip)
            #enable_osd(svs, True,
            #    _host=ip,
            #    _async=ASYNC_MODE.WAIT_UPDATED,
            #    _ticket=TASK_TICKET.ENABLE_OSD)
            #return errors.SUCCESS
        #except IfaceRoleChangeInUse:
        #    return errors.HOST.IFACE_ROLE_CHANGE_ERROR
        #except IfaceRoleNotDefined:
        #    return errors.HOST.IFACE_ROLE_NOT_DEFINED_ERROR
        #except Exception as e:
        #    logger.error(str(e))
        #    logger.error(traceback.format_exc())
        #    return errors.HOST.ENABLE_OSD_ROLE_ERROR

