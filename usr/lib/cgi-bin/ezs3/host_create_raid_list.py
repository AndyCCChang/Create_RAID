import web
from ezs3.log import EZLog
#from ezs3.diskutils import list_local_disks
from ezs3.raidutils import list_raids
from ezs3.raidutils import *

import errors

logger = EZLog.get_logger(__name__)


class Handler:
    def GET(self):
        form = web.input()
        raids = list_raids(_host=form.host)
        #storage_box = form.get('storage_box', '')
        #create_raids(storage_box)
#        disks = list_local_disks(_host=form.host)
        return errors.SUCCESS, raids
