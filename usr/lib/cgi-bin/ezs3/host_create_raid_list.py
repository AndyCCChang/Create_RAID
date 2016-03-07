import web
from ezs3.log import EZLog
from ezs3.diskutils import list_local_disks
from ezs3.riadutils import list_raids

import errors

logger = EZLog.get_logger(__name__)


class Handler:
    def GET(self):
        form = web.input()
        raids = list_raids(_host=form.host)
#        disks = list_local_disks(_host=form.host)
        return errors.SUCCESS, raids
