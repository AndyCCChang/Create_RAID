#!/usr/bin/env python
import os
import web
import errors
from ezs3.account import get_account_manager, AccountType
from ezs3 import ezxml
from ezs3.central_log import get_central_logger
from ezs3.command import do_cmd
from ezs3.log import EZLog, SysLogFile
from ezs3.notify_manager import WebEventCache, EventPropagateCache
from templates import xml_response, xml_extra_response
from templates import json_response, json_extra_response
from ezs3.config import Ezs3CephConfig

logger = EZLog.get_logger("index")

def check_url_permission():
    login_type = web.ctx.login_type
    url_path = web.ctx.path
    if login_type == AccountType.ROOT:
        return True
    elif login_type == AccountType.ADMINISTRATOR:
        return True
    elif login_type == AccountType.SDS_ADMIN:
        if url_path in admin_urls:
            logger.error('User {} has no privilege to access {}'.format(web.ctx.login_id, web.ctx.path))
            return False
        else:
            return True
    else:
        logger.error('Unknown login type: {}'.format(web.ctx.login_type))
        return False

def extend_json_urls(in_urls):
    json_urls = []
    for i in range(len(in_urls)):
        if i % 2 == 0:
            path_list = in_urls[i].split('/')
            path_list.insert(2, 'json')
            json_urls.append('/'.join(path_list))
        else:
            json_urls.append(in_urls[i])
    in_urls.extend(json_urls)

def check_json_url():
    if web.ctx.path.split('/')[-2] == 'json':
        web.header("Content-Type", "application/json; charset=utf-8")
        return True
    else:
        web.header("Content-Type", "text/xml; charset=utf-8")
        return False

def response(name, rc):
    if check_json_url():
        return json_response(name, rc)
    else:
        return xml_response(name, rc)

def extra_response(name, rc, extra):
    if check_json_url():
        return json_extra_response(name, rc, extra)
    else:
        return xml_extra_response(name, rc, ezxml.dump(extra))

def processor(handler):
    api_name = web.ctx.path.split("/")[-1]

    if web.ctx.path not in anonymous_urls:
        if api_name != 'login' and api_name != 'logout' and not session.get('logged_in', False):
            if Ezs3CephConfig().get_cluster_name():
                raise web.unauthorized()
            else:
                # customize message to hint user login with root account
                raise web.unauthorized('need root')

        if api_name != 'login':
            # make login_id and login_type accessible by handlers
            web.ctx.login_id = session.get('login_id')
            web.ctx.login_type = session.get('login_type')
            if not check_url_permission():
                raise web.unauthorized()

    if api_name in binary_api:
        web.header('Content-type', 'application/octet-stream')
        return handler()
    else:
        result = handler()
        if isinstance(result, int):
            resp = response(api_name, result)
        elif isinstance(result, tuple):
            if len(result) == 2:
                resp = extra_response(api_name, result[0], result[1])
            else:
                logger.error("Invalid API response: {}".format(result))
                resp = response(api_name, errors.GENERAL.GENERAL_ERROR)
        else:
            logger.error("Invalid API response: {}".format(result))
            resp = response(api_name, errors.GENERAL.GENERAL_ERROR)
        return resp

binary_api = ['exported_central_log_get', 'backup_node']

admin_urls = [
    '/ezs3/get_ad_settings', 'get_ad_settings.Handler',
    '/ezs3/set_ad_settings', 'set_ad_settings.Handler',
    '/ezs3/get_dns', 'get_dns.Handler',
    '/ezs3/set_dns', 'set_dns.Handler',
    '/ezs3/get_notification', 'get_notification.Handler',
    '/ezs3/set_notification', 'set_notification.Handler',
    '/ezs3/get_folder_du', 'get_folder_du.Handler',
    '/ezs3/get_user_du', 'get_user_du.Handler',
    '/ezs3/gwgroup_assign', 'gwgroup_assign.Handler',
    '/ezs3/gwgroup_create', 'gwgroup_create.Handler',
    '/ezs3/gwgroup_delete', 'gwgroup_delete.Handler',
    '/ezs3/pool_add_node', 'pool_add_node.Handler',
    '/ezs3/pool_change_replica', 'pool_change_replica.Handler',
    '/ezs3/pool_create', 'pool_create.Handler',
    '/ezs3/pool_modify', 'pool_modify.Handler',
    '/ezs3/pool_del_node', 'pool_del_node.Handler',
    '/ezs3/pool_list', 'pool_list.Handler',
    '/ezs3/pool_list_base', 'pool_list_base.Handler',
    '/ezs3/pool_list_node', 'pool_list_node.Handler',
    '/ezs3/pool_set_quota', 'pool_set_quota.Handler',
    '/ezs3/pool_delete', 'pool_delete.Handler',
    '/ezs3/pool_enable_s3', 'pool_enable_s3.Handler',
    '/ezs3/pool_add_cache_pool', 'pool_add_cache_pool.Handler',
    '/ezs3/pool_remove_cache_pool', 'pool_remove_cache_pool.Handler',
    '/ezs3/pool_du_list', 'pool_du_list.Handler',
    '/ezs3/create_cluster', 'create_cluster.Handler',
    '/ezs3/leave_cluster', 'leave_cluster.Handler',
    '/ezs3/leave_cluster_progress', 'leave_cluster_progress.Handler',
    '/ezs3/kickout_host', 'kickout_host.Handler',
    '/ezs3/node_role_disable_osd', 'node_role_disable_osd.Handler',
    '/ezs3/node_role_enable_osd', 'node_role_enable_osd.Handler',
    '/ezs3/node_role_osd_progress', 'node_role_osd_progress.Handler',
    '/ezs3/node_role_disable_rrs', 'node_role_disable_rrs.Handler',
    '/ezs3/node_role_enable_rrs', 'node_role_enable_rrs.Handler',
    '/ezs3/node_role_rrs_progress', 'node_role_rrs_progress.Handler',
    '/ezs3/reset_user_key', 'reset_user_key.Handler',
    '/ezs3/s3_bucket_create', 's3_bucket_create.Handler',
    '/ezs3/s3_bucket_delete', 's3_bucket_delete.Handler',
    '/ezs3/s3_domain_get', 's3_domain_get.Handler',
    '/ezs3/s3_domain_set', 's3_domain_set.Handler',
    '/ezs3/s3_get_du', 's3_get_du.Handler',
    '/ezs3/s3_usage_get', 's3_usage_get.Handler',
    '/ezs3/s3_usage_trim', 's3_usage_trim.Handler',
    '/ezs3/sds_set_pool', 'sds_set_pool.Handler',
    '/ezs3/list_replication_key', 'list_replication_key.Handler',
    '/ezs3/add_replication_key', 'add_replication_key.Handler',
    '/ezs3/delete_replication_key', 'delete_replication_key.Handler',
    '/ezs3/delete_multi_replication_key', 'delete_multi_replication_key.Handler',
    '/ezs3/get_replication_task', 'get_replication_task.Handler',
    '/ezs3/get_replication_task_status', 'get_replication_task_status.Handler',
    '/ezs3/list_replication_task', 'list_replication_task.Handler',
    '/ezs3/create_replication_task', 'create_replication_task.Handler',
    '/ezs3/delete_replication_task', 'delete_replication_task.Handler',
    '/ezs3/delete_multi_replication_task', 'delete_multi_replication_task.Handler',
    '/ezs3/bucket_list', 'bucket_list.Handler',
    '/ezs3/del_user', 'del_user.Handler',
    '/ezs3/del_multi_user', 'del_multi_user.Handler',
    '/ezs3/user_info', 'user_info.Handler',
    '/ezs3/user_list', 'user_list.Handler',
    '/ezs3/add_user', 'add_user.Handler',
    '/ezs3/enable_user', 'enable_user.Handler',
    '/ezs3/suspend_user', 'suspend_user.Handler',
    '/ezs3/reset_user_password', 'reset_user_password.Handler',
    '/ezs3/search_ad_user', 'search_ad_user.Handler',
    '/ezs3/import_certificate', 'import_certificate.Handler',
    '/ezs3/ssh_pubkey_get', 'ssh_pubkey_get.Handler',
    '/ezs3/storage_moncfg_get', 'storage_moncfg_get.Handler',
    '/ezs3/storage_moncfg_set', 'storage_moncfg_set.Handler',
    '/ezs3/get_region_map', 'get_region_map.Handler',
    '/ezs3/create_master_region', 'create_master_region.Handler',
    '/ezs3/create_secondary_region', 'create_secondary_region.Handler',
    '/ezs3/modify_region_endpoints', 'modify_region_endpoints.Handler',
    '/ezs3/modify_zone_endpoints', 'modify_zone_endpoints.Handler',
    '/ezs3/ntp_server_get', 'ntp_server_get.Handler',
    '/ezs3/ntp_server_set', 'ntp_server_set.Handler',
    '/ezs3/sds_admin_edit', 'sds_admin_edit.Handler',
    '/ezs3/sds_admin_list', 'sds_admin_list.Handler',
    '/ezs3/sds_admin_add', 'sds_admin_add.Handler',
    '/ezs3/sds_admin_remove', 'sds_admin_remove.Handler',
    '/ezs3/sds_qos_get', 'sds_qos_get.Handler',
    '/ezs3/sds_qos_set', 'sds_qos_set.Handler',
    '/ezs3/sds_du_list', 'sds_du_list.Handler',
    '/ezs3/profile_check_name', 'profile_check_name.Handler',
    '/ezs3/hypervisor_fetch_information', 'hypervisor_fetch_information.Handler',
    '/ezs3/profile_create', 'profile_create.Handler',
    '/ezs3/profile_list', 'profile_list.Handler',
    '/ezs3/profile_details_get', 'profile_details_get.Handler',
    '/ezs3/profile_delete', 'profile_delete.Handler',
    '/ezs3/profile_validate', 'profile_validate.Handler',
    '/ezs3/gateway_vm_create', 'gateway_vm_create.Handler',
    '/ezs3/gateway_vm_list', 'gateway_vm_list.Handler',
    '/ezs3/gateway_vm_details_get', 'gateway_vm_details_get.Handler',
    '/ezs3/gateway_vm_terminate', 'gateway_vm_terminate.Handler',
    '/ezs3/license_info_get', 'license_info_get.Handler',
    '/ezs3/license_set', 'license_set.Handler',
    '/ezs3/license_check', 'license_check.Handler',
    '/ezs3/storage_volume_list', 'storage_volume_list.Handler',
    '/ezs3/storage_volume_add', 'storage_volume_add.Handler',
    '/ezs3/storage_volume_remove', 'storage_volume_remove.Handler',
    '/ezs3/journal_partition_get', 'journal_partition_get.Handler',
    '/ezs3/journal_partition_edit', 'journal_partition_edit.Handler',
    '/ezs3/partition_list', 'partition_list.Handler',
    '/ezs3/gateway_role_enable', 'gateway_role_enable.Handler',
    '/ezs3/gateway_role_disable', 'gateway_role_disable.Handler',
    '/ezs3/gateway_role_progress', 'gateway_role_progress.Handler',
    '/ezs3/storage_volume_scan', 'storage_volume_scan.Handler',
    '/ezs3/storage_volume_reformat', 'storage_volume_reformat.Handler',
    '/ezs3/storage_volume_edit', 'storage_volume_edit.Handler',
    '/ezs3/node_roles', 'node_roles.Handler',
    '/ezs3/list_node_roles', 'list_node_roles.Handler',
    '/ezs3/add_cluster_nodes', 'add_cluster_nodes.Handler',
    '/ezs3/add_cluster_nodes_progress', 'add_cluster_nodes_progress.Handler',
    '/ezs3/cluster_host_remove', 'cluster_host_remove.Handler',
    '/ezs3/cluster_management_status', 'cluster_management_status.Handler',
    '/ezs3/disable_incremental_recovery', 'disable_incremental_recovery.Handler',
    '/ezs3/disable_maintenance_mode', 'disable_maintenance_mode.Handler',
    '/ezs3/enable_incremental_recovery', 'enable_incremental_recovery.Handler',
    '/ezs3/enable_maintenance_mode', 'enable_maintenance_mode.Handler',
    '/ezs3/auto_reweight_get', 'auto_reweight_get.Handler',
    '/ezs3/auto_reweight_set', 'auto_reweight_set.Handler',
    '/ezs3/osd_recovery_qos_get', 'osd_recovery_qos_get.Handler',
    '/ezs3/osd_recovery_qos_set', 'osd_recovery_qos_set.Handler',
    '/ezs3/central_log_get', 'central_log_get.Handler',
    '/ezs3/central_log_detail_get', 'central_log_detail_get.Handler',
    '/ezs3/central_log_config_get', 'central_log_config_get.Handler',
    '/ezs3/cached_volume_list', 'cached_volume_list.Handler',
    '/ezs3/rbd_volume_list', 'rbd_volume_list.Handler',
    '/ezs3/rbd_volume_cache_create', 'rbd_volume_cache_create.Handler',
    '/ezs3/rbd_volume_cache_delete', 'rbd_volume_cache_delete.Handler',
    '/ezs3/fs_cache_enable', 'fs_cache_enable.Handler',
    '/ezs3/fs_cache_disable', 'fs_cache_disable.Handler',
    '/ezs3/fs_cache_status', 'fs_cache_status.Handler',
    '/ezs3/dashboard_layout_get', 'dashboard_layout_get.Handler',
    '/ezs3/dashboard_layout_set', 'dashboard_layout_set.Handler',
    '/ezs3/converger_config_modify', 'converger_config_modify.Handler',
    '/ezs3/converger_config_get', 'converger_config_get.Handler',
    '/ezs3/exported_central_log_get', 'exported_central_log_get.Handler',
    '/ezs3/exported_central_log_list', 'exported_central_log_list.Handler',
    '/ezs3/exported_central_log_delete', 'exported_central_log_delete.Handler',
    '/ezs3/backup_node', 'backup_node.Handler',
    '/ezs3/host_disk_status_image', 'host_disk_status_image.Handler',
    '/ezs3/hostname_set', 'hostname_set.Handler',
    '/ezs3/hostname_get', 'hostname_get.Handler',
    '/ezs3/timezone_set', 'timezone_set.Handler',
    '/ezs3/timezone_get', 'timezone_get.Handler',
    '/ezs3/get_rack_aware_status', 'get_rack_aware_status.Handler',
    '/ezs3/set_rackid', 'set_rackid.Handler'
]

urls = [
    '/ezs3/is_in_cluster', 'is_in_cluster.Handler',
    '/ezs3/cluster_status', 'cluster_status.Handler',
    '/ezs3/general_health', 'general_health.Handler',
    '/ezs3/cluster_info', 'cluster_info.Handler',
    '/ezs3/dns_nas_get', 'dns_nas_get.Handler',
    '/ezs3/dns_nas_set', 'dns_nas_set.Handler',
    '/ezs3/fc_add_target', 'fc_add_target.Handler',
    '/ezs3/fc_list_targets', 'fc_list_targets.Handler',
    '/ezs3/fc_remove_target', 'fc_remove_target.Handler',
    '/ezs3/fc_list_ports', 'fc_list_ports.Handler',
    '/ezs3/ip_takeover_get', 'ip_takeover_get.Handler',
    '/ezs3/ip_takeover_set', 'ip_takeover_set.Handler',
    '/ezs3/iscsi_add', 'iscsi_add.Handler',
    '/ezs3/iscsi_add_target', 'iscsi_add_target.Handler',
    '/ezs3/iscsi_change', 'iscsi_change.Handler',
    '/ezs3/iscsi_create_snap', 'iscsi_create_snap.Handler',
    '/ezs3/iscsi_disable', 'iscsi_disable.Handler',
    '/ezs3/iscsi_enable', 'iscsi_enable.Handler',
    '/ezs3/iscsi_multi_disable', 'iscsi_multi_disable.Handler',
    '/ezs3/iscsi_multi_enable', 'iscsi_multi_enable.Handler',
    '/ezs3/iscsi_get_target_config', 'iscsi_get_target_config.Handler',
    '/ezs3/iscsi_get_volume_status', 'iscsi_get_volume_status.Handler',
    '/ezs3/iscsi_get_snap_info', 'iscsi_get_snap_info.Handler',
    '/ezs3/iscsi_list', 'iscsi_list.Handler',
    '/ezs3/iscsi_list_snap', 'iscsi_list_snap.Handler',
    '/ezs3/iscsi_list_targets', 'iscsi_list_targets.Handler',
    '/ezs3/iscsi_remove', 'iscsi_remove.Handler',
    '/ezs3/iscsi_multi_remove', 'iscsi_multi_remove.Handler',
    '/ezs3/iscsi_remove_snap', 'iscsi_remove_snap.Handler',
    '/ezs3/iscsi_remove_target', 'iscsi_remove_target.Handler',
    '/ezs3/iscsi_rollback_snap', 'iscsi_rollback_snap.Handler',
    '/ezs3/iscsi_get', 'iscsi_get.Handler',
    '/ezs3/iscsi_set_target_config', 'iscsi_set_target_config.Handler',
    '/ezs3/list_targets', 'list_targets.Handler',
    '/ezs3/rbd_list_snap', 'rbd_list_snap.Handler',
    '/ezs3/rbd_remove_snap', 'rbd_remove_snap.Handler',
    '/ezs3/rbd_rollback_snap', 'rbd_rollback_snap.Handler',
    '/ezs3/rbd_get', 'rbd_get.Handler',
    '/ezs3/rbd_create_snap', 'rbd_create_snap.Handler',
    '/ezs3/rbd_change', 'rbd_change.Handler',
    '/ezs3/rbd_get_snap_size', 'rbd_get_snap_size.Handler',
    '/ezs3/rbd_delete', 'rbd_delete.Handler',
    '/ezs3/iscsi_change_qos', 'iscsi_change_qos.Handler',
    '/ezs3/smb_adcfg_get', 'smb_adcfg_get.Handler',
    '/ezs3/smb_adcfg_set', 'smb_adcfg_set.Handler',
    '/ezs3/list_shared_folder', 'list_shared_folder.Handler',
    '/ezs3/delete_shared_folder', 'delete_shared_folder.Handler',
    '/ezs3/enable_shared_folder', 'enable_shared_folder.Handler',
    '/ezs3/disable_shared_folder', 'disable_shared_folder.Handler',
    '/ezs3/delete_multi_shared_folder', 'delete_multi_shared_folder.Handler',
    '/ezs3/enable_multi_shared_folder', 'enable_multi_shared_folder.Handler',
    '/ezs3/disable_multi_shared_folder', 'disable_multi_shared_folder.Handler',
    '/ezs3/create_shared_folder', 'create_shared_folder.Handler',
    '/ezs3/edit_shared_folder', 'edit_shared_folder.Handler',
    '/ezs3/search_user', 'search_user.Handler',
    '/ezs3/search_file', 'search_file.Handler',
    '/ezs3/folder_migration_get_status', 'folder_migration_get_status.Handler',
    '/ezs3/folder_migration_start', 'folder_migration_start.Handler',
    '/ezs3/folder_migration_suspend', 'folder_migration_suspend.Handler',
    '/ezs3/folder_migration_terminate', 'folder_migration_terminate.Handler',
    '/ezs3/folder_change_qos', 'folder_change_qos.Handler',
    '/ezs3/folder_delete_qos', 'folder_delete_qos.Handler',
    '/ezs3/folder_change_default_qos', 'folder_change_default_qos.Handler',
    '/ezs3/folder_delete_default_qos', 'folder_delete_default_qos.Handler',
    '/ezs3/folder_get_default_qos', 'folder_get_default_qos.Handler',
    '/ezs3/logout', 'logout',
    '/ezs3/login', 'login',
    '/ezs3/net_share_mount', 'net_share_mount.Handler',
    '/ezs3/event_get', 'event_get',
    '/ezs3/change_password', 'change_password.Handler',
    '/ezs3/gwgroup_list', 'gwgroup_list.Handler',
    '/ezs3/sds_get_pool', 'sds_get_pool.Handler',
    '/ezs3/set_qos_policies', 'set_qos_policies.Handler',
    '/ezs3/get_qos_policies', 'get_qos_policies.Handler',
    '/ezs3/get_qos_lowerbounds', 'get_qos_lowerbounds.Handler',
    '/ezs3/host_enclosure_info', 'host_enclosure_info.Handler',
    '/ezs3/host_local_disk_list', 'host_local_disk_list.Handler',
    '/ezs3/host_iscsi_disk_list', 'host_iscsi_disk_list.Handler',
    '/ezs3/host_create_raid_list', 'host_create_raid_list.Handler',
    '/ezs3/create_raid', 'create_raid.Handler',
    '/ezs3/host_iscsi_list', 'host_iscsi_list.Handler',
    '/ezs3/host_iscsi_login', 'host_iscsi_login.Handler',
    '/ezs3/host_iscsi_logout', 'host_iscsi_logout.Handler',
    '/ezs3/host_iscsi_list_target', 'host_iscsi_list_target.Handler',
    '/ezs3/host_nas_disk_list', 'host_nas_disk_list.Handler',
    '/ezs3/host_nas_disk_create', 'host_nas_disk_create.Handler',
    '/ezs3/host_nas_disk_destroy', 'host_nas_disk_destroy.Handler',
    '/ezs3/host_feature_type', 'host_feature_type.Handler',
    '/ezs3/iscsi_add_md', 'iscsi_add_md.Handler',
    '/ezs3/iscsi_change_md', 'iscsi_change_md.Handler',
    '/ezs3/iscsi_sync_md', 'iscsi_sync_md.Handler',
    '/ezs3/iscsi_resync_md', 'iscsi_resync_md.Handler',
    '/ezs3/list_all_nodes', 'list_all_nodes.Handler',
    '/ezs3/flatten_volumes', 'flatten_volumes.Handler',
    '/ezs3/get_statistic', 'get_statistic.Handler',
    '/ezs3/realtime_statistic', 'realtime_statistic.Handler',
    '/ezs3/historical_statistic', 'historical_statistic.Handler',
    '/ezs3/busiest_hosts', 'busiest_hosts.Handler',
    '/ezs3/busiest_virtual_storages', 'busiest_virtual_storages.Handler',
    '/ezs3/converge_info_get', 'converge_info_get.Handler',
    '/ezs3/query_progress', 'query_progress.Handler',
]

anonymous_urls = [
    '/ezs3/freenode_list', 'freenode_list.Handler',
    '/ezs3/host_nic_list', 'host_nic_list.Handler',
    '/ezs3/join_cluster', 'join_cluster.Handler',
    '/ezs3/join_cluster_progress', 'join_cluster_progress.Handler',
    '/ezs3/node_removed_evt', 'node_removed_evt.Handler',
    '/ezs3/software_info', 'software_info.Handler'
]

extend_json_urls(admin_urls)
extend_json_urls(urls)
extend_json_urls(anonymous_urls)

app = web.application(urls+admin_urls+anonymous_urls, globals())

# All cookies should be stored in path /
# Ref: http://my.oschina.net/scriptboy/blog/79983
web.config.session_parameters['timeout'] = 1800
web.config.session_parameters['cookie_path'] = '/'
session = web.session.Session(app, web.session.DiskStore('/tmp/sessions'))

app.add_processor(processor)

class login:
    def GET(self):
        form = web.input()
        username = form.get('user_id')
        password = form.get('password')

        acc_mgr = get_account_manager()
        event_cache = WebEventCache()

        if acc_mgr.authenticate(username, password):
            need_logging = False
            if acc_mgr.is_root_account(username):
                if Ezs3CephConfig().get_cluster_name():
                    # after cluster is established, local root is not allowed to login.
                    # user should use cluster admin instead
                    return errors.AUTH.LOGIN_ROOT_NOT_ALLOWED
                session.login_type = AccountType.ROOT
            elif acc_mgr.is_admin_account(username):
                session.login_type = AccountType.ADMINISTRATOR
                need_logging = True
            elif acc_mgr.is_sds_admin(username):
                session.login_type = AccountType.SDS_ADMIN
                need_logging = True
            else:
                return errors.AUTH.LOGIN_ERROR
            session.logged_in = True
            session.login_id = username
            web.setcookie('login_id', username, path='/')
            web.setcookie('login_type', AccountType.get_name(session.login_type), path='/')
            central_logger = get_central_logger()
            if need_logging:
                central_logger.auditing.user_login(account_type=AccountType.get_name(session.login_type), account_id=username)
            notify_sessions = event_cache.list_session()
            for notify_session in notify_sessions:
                if notify_session not in session.store:
                    event_cache.delete_session(notify_session)
            event_cache.create_session(session.session_id)
            return errors.SUCCESS
        else:
            return errors.AUTH.LOGIN_ERROR

class logout:
    def GET(self):
        session.kill()
        web.setcookie('login_id', '',  expires=-1, path='/')
        central_logger = get_central_logger()
        central_logger.auditing.user_logout(account_type=AccountType.get_name(session.login_type), account_id=session.login_id)
        event_cache = WebEventCache()
        event_cache.delete_session(session.session_id)
        return errors.SUCCESS

class event_get:
    def GET(self):
        form = web.input()
        load_history = form.get('load_history')
        length = form.get('length')
        resp = {'realtime_events': [], 'historical_events': []}

        acc_mgr = get_account_manager()
        login_id = session.get('login_id')
        if acc_mgr.is_root_account(login_id):
            logger.info('Skip loading event when login user is {}'.format(login_id))
            return errors.SUCCESS, resp

        event_cache = WebEventCache()
        realtime_events = event_cache.get_latest_events(session.session_id)
        resp = {'realtime_events': realtime_events}

        if load_history:
            historical_events = event_cache.get_history_events(length)
            resp['historical_events'] = historical_events

        return errors.SUCCESS, resp

class external_cgi:
    def GET(self):
        api_name = web.ctx.path.split("/")[-1]
        command = os.path.abspath(api_name)
        if os.path.exists(command):
            output = do_cmd(command)
            return ''.join([e.strip() for e in output.splitlines()[1:]])
        else:
            raise web.notfound()


if __name__ == "__main__":
    EZLog.init_handler(syslog=True, syslogfile=SysLogFile.EZS3_ADMIN, redirect_stderr=True)
    app.run()
