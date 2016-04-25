import web
from ezs3.log import EZLog
from ezs3.raidutils import list_raids
from ezs3.raidutils import *

import errors

logger = EZLog.get_logger(__name__)


class Handler:
    def GET(self):
        form = web.input()
        raids = list_raids(_host=form.host)
        return errors.SUCCESS, raids
