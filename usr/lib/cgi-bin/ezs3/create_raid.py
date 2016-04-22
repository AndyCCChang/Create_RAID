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
    def GET(self):
        form = web.input()
        storage_box = form.get('storage_box[]', '')
        create_raids(storage_box)
        return errors.SUCCESS

