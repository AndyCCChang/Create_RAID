// ref:  http://stackoverflow.com/questions/1802936/stop-all-active-ajax-requests-in-jquery
$.xhrPool = [];
$.xhrPool.abortAll = function() {
    $(this).each(function(idx, jqXHR) {
        jqXHR.abort();
    });
    $.xhrPool.length = 0
};

var AjaxInterface = function() {
    this.xhr_pool = [];
}

AjaxInterface.prototype.cancel_all = function() {
    for (var i = 0; i < this.xhr_pool.length; i++) {
        this.xhr_pool[i].abort();
    }
    this.xhr_pool = [];
}

AjaxInterface.prototype.post = function(api_name, data, success_cb, show_progress, error_cb) {
    // the api is called without any parameters
    if (typeof data == 'function') {
        error_cb = show_progress;
        show_progress = success_cb;
        success_cb = data;
        data = {};
    }
    return ajax_post.call(
        this,
        '/cgi-bin/ezs3/json/' + api_name,
        data,
        success_cb,
        show_progress,
        error_cb
    );
}

AjaxInterface.prototype.get = function(api_name, data, success_cb, error_cb, show_progress) {
    // the api is called without any parameters
    if (typeof data == 'function') {
        error_cb = show_progress;
        show_progress = success_cb;
        success_cb = data;
        data = {};
    }
    return ajax_get.call(
        this,
        '/cgi-bin/ezs3/json/' + api_name,
        data,
        success_cb,
        show_progress,
        error_cb
    );
}

function ajax_post(url, data, successCallback, isGlobal, errorCallback, isAsync) {
    if (isGlobal === undefined) {
        isGlobal = true;
    }
    if (isAsync == undefined) {
    	isAsync = true;
    }
    var self = this;
    var deferred = $.Deferred();
    $.ajax({
        type: 'POST',
        global: isGlobal,
        async: isAsync,
        cache: false,
        dataType: "json",
        data: data,
        url: url,
        beforeSend: function(jqXHR) {
            var xhr_pool = $.xhrPool;
            if (self instanceof AjaxInterface) {
                xhr_pool = self.xhr_pool;
            }
            xhr_pool.push(jqXHR);
        },
        success: function(data, statusText, jqXHR) {
            var ret = data.return_code;
            if (ret == 0) {
                if (successCallback) {
                    successCallback(data.response);
                }
                deferred.resolve(data, statusText, jqXHR);
            } else {
                if (errorCallback) {
                    errorCallback(data);
                } else {
                    alert(gAPIErrorMessage[ret]);
                }
                deferred.reject(data, statusText, jqXHR);
            }
        },
        error: function(jqXHR, statusText, errorThrown) {
            if (jqXHR.status == 401) {
                $("#dialog-login").modal('show');
                if (jqXHR.responseText == 'need root')
                    $('#root-login-desc').show();
                else
                    $('#root-login-desc').hide();
            } else if (jqXHR.getAllResponseHeaders()) {
                alert(getText("AJAX_ERROR"));
            }
            deferred.reject(jqXHR, statusText, errorThrown);
        },
        complete: function(jqXHR) {
            var xhr_pool = $.xhrPool;
            if (self instanceof AjaxInterface) {
                xhr_pool = self.xhr_pool;
            }
            var index = $.inArray(jqXHR, xhr_pool);
            if (index > -1) {
                xhr_pool.splice(index, 1);
            }
        }
    });

    return deferred.promise();
}

function ajax_get(url, data, successCallback, isGlobal, errorCallback, isAsync) {
    if (isGlobal === undefined) {
        isGlobal = true;
    }
    if (isAsync == undefined) {
    	isAsync = true;
    }
    var self = this;
    var deferred = $.Deferred();
    $.ajax({
        global: isGlobal,
        async: isAsync,
        cache: false,
        dataType: "json",
        data: data,
        url: url,
        beforeSend: function(jqXHR) {
            var xhr_pool = $.xhrPool;
            if (self instanceof AjaxInterface) {
                xhr_pool = self.xhr_pool;
            }
            xhr_pool.push(jqXHR);
        },
        success: function(data, statusText, jqXHR) {
            var ret = data.return_code;
            if (ret == 0) {
                if (successCallback) {
                    successCallback(data.response);
                }
                deferred.resolve(data, statusText, jqXHR);
            } else {
                if (errorCallback) {
                    errorCallback(data);
                } else {
                    alert(gAPIErrorMessage[ret]);
                }
                deferred.reject(data, statusText, jqXHR);
            }
        },
        error: function(jqXHR, statusText, errorThrown) {
            if (jqXHR.status == 401) {
                $("#dialog-login").modal('show');
                if (jqXHR.responseText == 'need root')
                    $('#root-login-desc').show();
                else
                    $('#root-login-desc').hide();
            } else if (jqXHR.getAllResponseHeaders()) {
                alert(getText("AJAX_ERROR"));
            }

            deferred.reject(jqXHR, statusText, errorThrown);
        },
        complete: function(jqXHR) {
            var xhr_pool = $.xhrPool;
            if (self instanceof AjaxInterface) {
                xhr_pool = self.xhr_pool;
            }
            var index = $.inArray(jqXHR, xhr_pool);
            if (index > -1) {
                xhr_pool.splice(index, 1);
            }
        }
    });

    return deferred.promise();
}

function ajax_login(user_id, password, successCallback, isGlobal) {
    var data = {
        user_id: user_id,
        password: password
    }
    return ajax_get("/cgi-bin/ezs3/json/login", data, successCallback, isGlobal);
}

function ajax_logout(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/logout", {}, successCallback, isGlobal);
}

function ajax_auto_reweight_get(pool, successCallback, isGlobal) {
    if (pool)
	return ajax_get("/cgi-bin/ezs3/json/auto_reweight_get", {pool: pool}, successCallback, isGlobal);
    else
	return ajax_get("/cgi-bin/ezs3/json/auto_reweight_get", {}, successCallback, isGlobal);
}

function ajax_auto_reweight_set(pool, threshold, successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/auto_reweight_set", {pool: pool, threshold: threshold}, successCallback, isGlobal);
}

function ajax_change_password(old_password, new_password, confirm_password, successCallback, isGlobal) {
    var data = {
        old_password: old_password,
        new_password: new_password,
        confirm_password: confirm_password
    }
    return ajax_get("/cgi-bin/ezs3/json/change_password", data, successCallback, isGlobal);
}

function ajax_user_list(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/user_list", {}, successCallback, isGlobal);
}

function ajax_reset_user_password(user_id, password, confirm_password, successCallback, isGlobal) {
    var data = {
        user_id: user_id,
        password: password,
        confirm_password: confirm_password
    };
    return ajax_get("/cgi-bin/ezs3/json/reset_user_password", data, successCallback, isGlobal);
}

function ajax_suspend_user(user_id, successCallback, isGlobal) {
    var data = { user_id: user_id };
    return ajax_get("/cgi-bin/ezs3/json/suspend_user", data, successCallback, isGlobal);
}

function ajax_add_user(user_id, display_name, email, password, confirm_password, type, dn, successCallback, isGlobal) {
    var data = {
        user_id: user_id,
        display_name: display_name,
        email: email,
        password: password,
        confirm_password: confirm_password,
        type: type,
        dn: dn
    };
    return ajax_get("/cgi-bin/ezs3/json/add_user", data, successCallback, isGlobal);
}

function ajax_enable_user(user_id, successCallback, isGlobal) {
    var data = { user_id: user_id };
    return ajax_get("/cgi-bin/ezs3/json/enable_user", data, successCallback, isGlobal);
}

function ajax_del_user(user_id, successCallback, isGlobal) {
    var data = { user_id: user_id };
    return ajax_get("/cgi-bin/ezs3/json/del_user", data, successCallback, isGlobal);
}

function ajax_del_multi_user(user_ids, successCallback, isGlobal) {
    var data = { user_ids: user_ids };
    return ajax_post("/cgi-bin/ezs3/json/del_multi_user", data, successCallback, isGlobal);
}

function ajax_reset_user_key(user_id, successCallback, isGlobal) {
    var data = { user_id: user_id };
    return ajax_get("/cgi-bin/ezs3/json/reset_user_key", data, successCallback, isGlobal);
}

function ajax_get_user_du(user_id, successCallback, isGlobal) {
    var data = { user_id: user_id };
    return ajax_get("/cgi-bin/ezs3/json/get_user_du", data, successCallback, isGlobal);
}

function ajax_cluster_status(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/cluster_status", {}, successCallback, isGlobal);
}

function ajax_get_replication_task_status(task_ids) {
    var data = { task_id: task_ids.join(" ") };
    return ajax_get("/cgi-bin/ezs3/json/get_replication_task_status", data, null, false);
}

function ajax_search_ad_user(search_key, successCallback, isGlobal) {
    var data = { search_key: search_key };
    return ajax_get("/cgi-bin/ezs3/json/search_ad_user", data, successCallback, isGlobal);
}

function ajax_pool_list_node(pool_name, successCallback, isGlobal) {
    var data = { pool_name: pool_name };
    return ajax_get("/cgi-bin/ezs3/json/pool_list_node", data, successCallback, isGlobal);
}

function ajax_pool_change_replica(pool_name, replica, successCallback, isGlobal) {
    var data = {
        pool_name: pool_name,
        replica: replica
    };
    return ajax_get("/cgi-bin/ezs3/json/pool_change_replica", data, successCallback, isGlobal);
}

function ajax_pool_set_quota(pool_name, quota, successCallback, isGlobal) {
    var data = {
        pool_name: pool_name,
        quota: quota
    };
    return ajax_get("/cgi-bin/ezs3/json/pool_set_quota", data, successCallback, isGlobal);
}

function ajax_pool_list(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/pool_list", {}, successCallback, isGlobal);
}

function ajax_pool_list_base(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/pool_list_base", {}, successCallback, isGlobal);
}

function ajax_pool_create(pool_name, pool_type, settings, successCallback, isGlobal) {
    var data = {
        pool_name: pool_name,
        pool_type: pool_type,
        settings: settings
    };
    return ajax_get("/cgi-bin/ezs3/json/pool_create", data, successCallback, isGlobal);
}

function ajax_pool_modify(pool_name, pool_type, settings, successCallback, isGlobal) {
    var data = {
        pool_name: pool_name,
        pool_type: pool_type,
        settings: settings
    };
    return ajax_get("/cgi-bin/ezs3/json/pool_modify", data, successCallback, isGlobal);
}

function ajax_pool_delete(pool_name, successCallback, isGlobal) {
    var data = { pool_name: pool_name };
    return ajax_get("/cgi-bin/ezs3/json/pool_delete", data, successCallback, isGlobal);
}

function ajax_s3_set_pool(pool_name, successCallback, isGlobal) {
    var data = { pool_name: pool_name };
    return ajax_get("/cgi-bin/ezs3/json/pool_enable_s3", data, successCallback, isGlobal);
}

function ajax_add_cache_pool(base, cache, cachesize, dirty, full, successCallback, isGlobal) {
    var data = {
        base_pool: base, cache_pool: cache, cache_size: cachesize,
        dirty_ratio: dirty, full_ratio: full
    };
    return ajax_get("/cgi-bin/ezs3/json/pool_add_cache_pool", data, successCallback, isGlobal);
}

function ajax_remove_cache_pool(base, cache, successCallback, isGlobal) {
    var data = { base_pool: base, cache_pool: cache };
    return ajax_get("/cgi-bin/ezs3/json/pool_remove_cache_pool", data, successCallback, isGlobal);
}

function ajax_del_node(node_ip, successCallback, isGlobal) {
    var data = { node_ip: node_ip };
    return ajax_get("/cgi-bin/ezs3/json/del_node", data, successCallback, isGlobal);
}

function ajax_reset_node(node_ip, successCallback, isGlobal) {
    var data = { node_ip: node_ip };
    return ajax_get("/cgi-bin/ezs3/json/reset_node", data, successCallback, isGlobal);
}

function ajax_get_dns(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/get_dns", {}, successCallback, isGlobal);
}

function ajax_pool_del_node(pool_id, node_ids, successCallback, isGlobal) {
    var data = {
        pool_id: pool_id,
        node_ids: node_ids
    };
    return ajax_get("/cgi-bin/ezs3/json/pool_del_node", data, successCallback, isGlobal);
}

function ajax_pool_add_node(pool_id, node_ids, successCallback, isGlobal) {
    var data = {
        pool_id: pool_id,
        node_ids: node_ids
    };
    return ajax_get("/cgi-bin/ezs3/json/pool_add_node", data, successCallback, isGlobal);
}

function ajax_get_notification(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/get_notification", {}, successCallback, isGlobal);
}

function ajax_s3_domain_get(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/s3_domain_get", {}, successCallback, isGlobal);
}

function ajax_hostname_get(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/hostname_get", {}, successCallback, isGlobal);
}

function ajax_storage_moncfg_get(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/storage_moncfg_get", {}, successCallback, isGlobal);
}

function ajax_list_all_nodes(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/list_all_nodes", {}, successCallback, isGlobal);
}

function ajax_import_certificate(certificate, private_key, successCallback, isGlobal) {
    var data = {
        certificate: certificate,
        private_key: private_key
    };
    return ajax_post("/cgi-bin/ezs3/json/import_certificate", data, successCallback, isGlobal);
}

function ajax_set_notification(email_list, email_sender, smtp_server,
			       smtp_encrypt, smtp_auth, smtp_account,
			       smtp_password, send_test_mail, successCallback,
			       isGlobal)
{
    var data = {
        email_list: email_list,
        email_sender: email_sender,
        smtp_server: smtp_server,
        smtp_encrypt: smtp_encrypt,
        smtp_auth: smtp_auth,
        smtp_account: smtp_account,
        smtp_password: smtp_password,
        send_test_mail: send_test_mail
    };
    return ajax_get("/cgi-bin/ezs3/json/set_notification", data, successCallback, isGlobal);
}

function ajax_set_dns(enable, vip, fqdn, successCallback, isGlobal) {
    var domain = "";
    var hostname = "";
    if (fqdn.length > 0) {
        var i = fqdn.indexOf(".");
        hostname = fqdn.substr(0, i);
        domain = fqdn.substr(i+1);
    }
    var data = {
        enable: enable,
        vip: vip,
        hostname_s3webdav: hostname,
        domain: domain
    };
    return ajax_get("/cgi-bin/ezs3/json/set_dns", data, successCallback, isGlobal);
}

function ajax_s3_domain_set(domain_name, successCallback, isGlobal) {
    var data = { domain_name: domain_name };
    return ajax_get("/cgi-bin/ezs3/json/s3_domain_set", data, successCallback, isGlobal);
}

function ajax_hostname_set(hostname, successCallback, isGlobal) {
    var data = { hostname: hostname };
    return ajax_get("/cgi-bin/ezs3/json/hostname_set", data, successCallback, isGlobal);
}

function ajax_storage_moncfg_set(ip, upload, tunnel, successCallback, isGlobal) {
    var data = {
        ip: ip,
        upload: upload,
        tunnel: tunnel
    };
    return ajax_get("/cgi-bin/ezs3/json/storage_moncfg_set", data, successCallback, isGlobal);
}

function ajax_list_replication_task(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/list_replication_task", {}, successCallback, isGlobal);
}

function ajax_list_replication_key(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/list_replication_key", {}, successCallback, isGlobal);
}

function ajax_get_region_map(successCallback, isGlobal, errorCallback) {
    return ajax_get("/cgi-bin/ezs3/json/get_region_map", {}, successCallback, isGlobal, errorCallback);
}

function ajax_delete_replication_task(id, successCallback, isGlobal) {
    var data = { id: id };
    return ajax_get("/cgi-bin/ezs3/json/delete_replication_task", data,
                    successCallback, isGlobal);
}

function ajax_delete_multi_replication_task(
        id_list, successCallback, isGlobal) {
    var data = { id_list: id_list };
    return ajax_get("/cgi-bin/ezs3/json/delete_multi_replication_task", data,
                    successCallback, isGlobal);
}

function ajax_delete_replication_key(name, successCallback, isGlobal) {
    var data = { name: name };
    return ajax_get("/cgi-bin/ezs3/json/delete_replication_key", data, successCallback, isGlobal);
}

function ajax_delete_multi_replication_key(
        name_list, successCallback, isGlobal) {
    var data = { name_list: name_list };
    return ajax_get("/cgi-bin/ezs3/json/delete_multi_replication_key", data,
                    successCallback, isGlobal);
}

function ajax_iscsi_list(gateway_group, target_id, rw, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        target_id: target_id,
        rw: rw
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_list", data, successCallback, isGlobal);
}

function ajax_list_shared_folder(gateway_group, successCallback, isGlobal) {
    var data = { gateway_group: gateway_group };
    return ajax_get("/cgi-bin/ezs3/json/list_shared_folder", data, successCallback, isGlobal);
}

function ajax_iscsi_list_targets(gateway_group, successCallback, isGlobal) {
    var data = { gateway_group: gateway_group };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_list_targets", data, successCallback, isGlobal);
}

function ajax_bucket_list(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/bucket_list", {}, successCallback, isGlobal);
}

function ajax_dns_nas_get(gateway_group, successCallback, isGlobal) {
    var data = {gateway_group: gateway_group};
    return ajax_get("/cgi-bin/ezs3/json/dns_nas_get", data, successCallback, isGlobal);
}

function ajax_dns_nas_set(gateway_group, enable, hostname, successCallback, isGlobal) {
    var data = {
	    gateway_group: gateway_group,
	    enable: enable,
	    hostname: hostname
    };
    return ajax_get("/cgi-bin/ezs3/json/dns_nas_set", data, successCallback, isGlobal);
}

function ajax_ssh_pubkey_get(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/ssh_pubkey_get", {}, successCallback, isGlobal);
}

function ajax_modify_region_endpoints(region, endpoints, successCallback, isGlobal) {
    var data = {
        region: region,
        endpoints: endpoints
    };
    return ajax_get("/cgi-bin/ezs3/json/modify_region_endpoints", data, successCallback, isGlobal);
}

function ajax_create_replication_task(op, id, name, type, src_vs, src, dst_vs,
				      dst, akey, skey, useoplog, server,
				      schedule, autoconf, successCallback,
				      isGlobal) {
    var data = {
        op: op,
        id: id,
        name: name,
        type: type,
        src_vs: src_vs,
        src: src,
        dst_vs: dst_vs,
        dst: dst,
        akey: akey,
        skey: skey,
        useoplog: useoplog,
        server: server,
        schedule: schedule,
        autoconf: autoconf
    };
    return ajax_get("/cgi-bin/ezs3/json/create_replication_task", data, successCallback, isGlobal);
}

function ajax_add_replication_key(name, content, successCallback, isGlobal) {
    var data = {
        name: name,
        content: content
    };
    return ajax_get("/cgi-bin/ezs3/json/add_replication_key", data, successCallback, isGlobal);
}

function ajax_create_master_region(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/create_master_region", {}, successCallback, isGlobal);
}

function ajax_modify_zone_endpoints(region, zone, endpoints, successCallback, isGlobal) {
    var data = {
        region: region,
        zone: zone,
        endpoints: endpoints
    };
    return ajax_get("/cgi-bin/ezs3/json/modify_zone_endpoints", data, successCallback, isGlobal);
}

function ajax_create_secondary_region(master_host, region_name, zone_name, successCallback, isGlobal) {
    var data = {
        master_host: master_host,
        region_name: region_name,
        zone_name: zone_name
    };
    return ajax_get("/cgi-bin/ezs3/json/create_secondary_region", data, successCallback, isGlobal);
}

function ajax_realtime_statistic(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/realtime_statistic", {}, successCallback, isGlobal);
}

function ajax_get_statistic(node_ip, successCallback, isGlobal) {
    var data = { node_ip: node_ip };
    return ajax_get("/cgi-bin/ezs3/json/get_statistic", data, successCallback, isGlobal);
}

function ajax_iscsi_list_snap(gateway_group, iscsi_id, target_id, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        iscsi_id: iscsi_id,
        target_id: target_id
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_list_snap", data, successCallback, isGlobal);
}

function ajax_iscsi_disable(gateway_group, iscsi_id_list, target_id, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        iscsi_id_list: iscsi_id_list,
        target_id: target_id
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_multi_disable", data, successCallback, isGlobal);
}

function ajax_iscsi_enable(gateway_group, iscsi_id_list, target_id, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        iscsi_id_list: iscsi_id_list,
        target_id: target_id
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_multi_enable", data, successCallback, isGlobal);
}

function ajax_iscsi_remove(gateway_group, iscsi_id, target_id, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        iscsi_id: iscsi_id,
        target_id: target_id
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_remove", data, successCallback, isGlobal);
}

function ajax_iscsi_multi_remove(gateway_group, iscsi_id_list, target_id, successCallback, isGlobal, errorCallback) {
    var data = {
        gateway_group: gateway_group,
        iscsi_id_list: iscsi_id_list,
        target_id: target_id
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_multi_remove", data, successCallback, isGlobal, errorCallback);
}

function ajax_fc_add_target(gateway_group, gateway, pool_id, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        gateway: gateway,
        pool_id: pool_id
    };
    return ajax_get("/cgi-bin/ezs3/json/fc_add_target", data, successCallback, isGlobal);
}

function ajax_fc_remove_target(gateway_group, gateway, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        gateway: gateway
    };
    return ajax_get("/cgi-bin/ezs3/json/fc_remove_target", data, successCallback, isGlobal);
}

function ajax_fc_list_targets(gateway_group, successCallback, isGlobal) {
    var data = { gateway_group: gateway_group };
    return ajax_get("/cgi-bin/ezs3/json/fc_list_targets", data, successCallback, isGlobal);
}

function ajax_iscsi_remove_snap(gateway_group, iscsi_id, target_id, snap_name, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        iscsi_id: iscsi_id,
        target_id: target_id,
        snap_name: snap_name
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_remove_snap", data, successCallback, isGlobal);
}

function ajax_iscsi_get_target_config(gateway_group, target_id, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        target_id: target_id
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_get_target_config", data, successCallback, isGlobal);
}

function ajax_iscsi_get_volume_status(gateway_group, iscsi_id, target_id, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        iscsi_id: iscsi_id,
        target_id: target_id
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_get_volume_status", data, successCallback, isGlobal);
}

function ajax_iscsi_change(gateway_group, iscsi_id, target_id, size,
			   qos_enabled, maxbw, maxiops, snapshot_enabled,
			   snapshot_interval_min, snapshot_since, snapshot_max,
			   successCallback, isGlobal)
{
    var data = {
        gateway_group: gateway_group,
        iscsi_id: iscsi_id,
        target_id: target_id,
        size: size,
        qos_enabled: qos_enabled,
        maxbw: maxbw,
        maxiops: maxiops,
        snapshot_enabled: snapshot_enabled,
        snapshot_interval_min: snapshot_interval_min,
        snapshot_since: snapshot_since,
        snapshot_max: snapshot_max
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_change", data, successCallback, isGlobal);
}

function ajax_iscsi_add(gateway_group, iscsi_id, target_id, size,
                        snapshot_enabled, snapshot_interval_min, snapshot_since, snapshot_max,
                        successCallback, isGlobal, errorCallback) {
    var data = {
        gateway_group: gateway_group,
        iscsi_id: iscsi_id,
        target_id: target_id,
        size: size,
        snapshot_enabled: snapshot_enabled,
        snapshot_interval_min: snapshot_interval_min,
        snapshot_since: snapshot_since,
        snapshot_max: snapshot_max
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_add", data, successCallback, isGlobal, errorCallback);
}

function ajax_iscsi_set_target_config(target_id, gateway_group, write_through, acl_allowed_list, acl_denied_list, enable_auth, username, password, out_name, out_secret, pool_id, successCallback, isGlobal, enable_initiator) {
    var data = {
        target_id: target_id,
        gateway_group: gateway_group,
        write_through: write_through,
        acl_allowed_list: acl_allowed_list,
        acl_denied_list: acl_denied_list,
        enable_auth: enable_auth,
        username: username,
        password: password,
        out_name: out_name,
        out_secret: out_secret,
        pool_id: pool_id,
        enable_initiator: enable_initiator
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_set_target_config", data, successCallback, isGlobal);
}

function ajax_iscsi_create_snap(gateway_group, iscsi_id, target_id, snap_name, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        iscsi_id: iscsi_id,
        target_id: target_id,
        snap_name: snap_name
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_create_snap", data, successCallback, isGlobal);
}

function ajax_iscsi_remove_target(gateway_group, target_id, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        target_id: target_id
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_remove_target", data, successCallback, isGlobal);
}

function ajax_iscsi_rollback_snap(gateway_group, iscsi_id, target_id, snap_name, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        iscsi_id: iscsi_id,
        target_id: target_id,
        snap_name: snap_name
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_rollback_snap", data, successCallback, isGlobal);
}

function ajax_iscsi_add_target(gateway_group, target_id, pool_id,
			       successCallback, isGlobal, errorCallback) {
    var data = {
        gateway_group: gateway_group,
        target_id: target_id,
        pool_id: pool_id
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_add_target", data,
	    	    successCallback, isGlobal, errorCallback);
}

function ajax_delete_multi_shared_folder(name_list, gateway_group, successCallback, isGlobal) {
    var data = {
        name_list: name_list,
        gateway_group: gateway_group
    };
    return ajax_get("/cgi-bin/ezs3/json/delete_multi_shared_folder", data, successCallback, isGlobal);
}

function ajax_enable_multi_shared_folder(name_list, gateway_group, successCallback, isGlobal) {
    var data = {
        name_list: name_list,
        gateway_group: gateway_group
    };
    return ajax_get("/cgi-bin/ezs3/json/enable_multi_shared_folder", data, successCallback, isGlobal);
}

function ajax_disable_multi_shared_folder(name_list, gateway_group, successCallback, isGlobal) {
    var data = {
        name_list: name_list,
        gateway_group: gateway_group
    };
    return ajax_get("/cgi-bin/ezs3/json/disable_multi_shared_folder", data, successCallback, isGlobal);
}

function ajax_create_shared_folder(name, gateway_group, nfs, smb, read_only, mode, write_list, allowed_hosts, guest_ok, user_list, pool,
				   minfo_enabled, minfo_gateway, minfo_host,
				   minfo_fs_type, minfo_share, minfo_copyup,
				   minfo_account, minfo_password, minfo_cifsacl,
				   minfo_options, successCallback, isGlobal)
{
    var data = {
        name: name,
        gateway_group: gateway_group,
        nfs: nfs,
        smb: smb,
        read_only: read_only,
        mode: mode,
        write_list: write_list,
        allowed_hosts: allowed_hosts,
        guest_ok: guest_ok,
        user_list: user_list,
        pool: pool,
        migrate_folder: minfo_enabled,
        migrate_gw_ip: minfo_gateway,
        migrate_server: minfo_host,
        migrate_fs_type: minfo_fs_type,
        migrate_path: minfo_share,
        migrate_copyup: minfo_copyup,
        migrate_account: minfo_account,
        migrate_passwd: minfo_password,
        migrate_cifsacl: minfo_cifsacl,
        migrate_fs_options: minfo_options
    };
    return ajax_get("/cgi-bin/ezs3/json/create_shared_folder", data, successCallback, isGlobal);
}

function ajax_edit_shared_folder(name, gateway_group, nfs, smb, read_only, mode, write_list, allowed_hosts, guest_ok, user_list, successCallback, isGlobal) {
    var data = {
        name: name,
        gateway_group: gateway_group,
        nfs: nfs,
        smb: smb,
        read_only: read_only,
        mode: mode,
        write_list: write_list,
        allowed_hosts: allowed_hosts,
        guest_ok: guest_ok,
        user_list: user_list
    };
    return ajax_post("/cgi-bin/ezs3/json/edit_shared_folder", data, successCallback, isGlobal);
}

function ajax_folder_migrate_get_status(vs_id, name, successCallback, isGlobal, errorCallback, isAsync) {
    var data = { vs_id: vs_id, name: name };
    return ajax_get("/cgi-bin/ezs3/json/folder_migration_get_status", data, successCallback, isGlobal, errorCallback, isAsync);
}

function ajax_folder_migration_start(vs_id, name, max_bw, successCallback) {
    var data = { vs_id: vs_id, name: name, max_bw: max_bw };
    return ajax_get("/cgi-bin/ezs3/json/folder_migration_start", data, successCallback);
}

function ajax_folder_migration_suspend(vs_id, name, successCallback) {
    var data = { vs_id: vs_id, name: name };
    return ajax_get("/cgi-bin/ezs3/json/folder_migration_suspend", data, successCallback);
}

function ajax_folder_migration_terminate(vs_id, name, successCallback) {
    var data = { vs_id: vs_id, name: name };
    return ajax_get("/cgi-bin/ezs3/json/folder_migration_terminate", data, successCallback);
}

function ajax_net_share_test_mount(server, type, share, account, password,
				   extra_options, successCallback, isGlobal, errorCallback, isAsync) {
    var data = {
	server: server,
	fs_type: type,
	share_name: share,
	account: account,
	password: password,
	fs_options: extra_options,
	gateway: "",
	path: "",
	umount: true
    };
    return ajax_get("/cgi-bin/ezs3/json/net_share_mount", data, successCallback, isGlobal, errorCallback, isAsync);
}

function ajax_search_user(gateway_group, search_key, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        search_key: search_key
    };
    return ajax_get("/cgi-bin/ezs3/json/search_user", data, successCallback, isGlobal);
}

function ajax_gwgroup_list(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/gwgroup_list", {}, successCallback, isGlobal);
}

function ajax_gwgroup_create(name, successCallback, isGlobal, errorCallback) {
    var data = { name: name };
    return ajax_get("/cgi-bin/ezs3/json/gwgroup_create", data, successCallback, isGlobal, errorCallback);
}

function ajax_gwgroup_delete(name, successCallback, isGlobal, errorCallback) {
    var data = { name: name };
    return ajax_get("/cgi-bin/ezs3/json/gwgroup_delete", data, successCallback, isGlobal, errorCallback);
}

function ajax_gwgroup_get_pools(group_name, successCallback, isGlobal) {
    var data = { gateway_group: group_name};
    return ajax_get("/cgi-bin/ezs3/json/sds_get_pool", data, successCallback, isGlobal);
}

function ajax_gwgroup_assign(group, hosts, successCallback, isGlobal, errorCallback) {
    var data = {
        group: group,
        hosts: hosts
    };
    return ajax_get("/cgi-bin/ezs3/json/gwgroup_assign", data, successCallback, isGlobal, errorCallback);
}

function ajax_sds_set_pool(gateway_group, pool_list, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        pool_list: pool_list
    };
    return ajax_get("/cgi-bin/ezs3/json/sds_set_pool", data, successCallback, isGlobal);
}

function ajax_ip_takeover_get(gateway_group, successCallback, isGlobal, errorCallback) {
    var data = { gateway_group: gateway_group };
    return ajax_get("/cgi-bin/ezs3/json/ip_takeover_get", data, successCallback, isGlobal, errorCallback);
}

function ajax_ip_takeover_set(gateway_group, ips_list, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        ips_list: ips_list
    };
    return ajax_get("/cgi-bin/ezs3/json/ip_takeover_set", data, successCallback, isGlobal);
}

function ajax_get_ad_settings(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/get_ad_settings", {}, successCallback, isGlobal);
}

function ajax_set_ad_settings(enabled, server, port, base_dn, use_https, search_dn, ad_account, ad_password, successCallback, isGlobal) {
    var data = {
        enabled: enabled,
        server: server,
        port: port,
        base_dn: base_dn,
        use_https: use_https,
        search_dn: search_dn,
        ad_account: ad_account,
        ad_password: ad_password
    };
    return ajax_get("/cgi-bin/ezs3/json/set_ad_settings", data, successCallback, isGlobal);
}

function ajax_smb_adcfg_set(gateway_group, domain, domain_netbios, hostname, account, passwd, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        domain: domain,
        domain_netbios: domain_netbios,
        hostname: hostname,
        account: account,
        passwd: passwd
    };
    return ajax_get("/cgi-bin/ezs3/json/smb_adcfg_set", data, successCallback, isGlobal);
}

function ajax_smb_adcfg_get(gateway_group, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group
    };
    return ajax_get("/cgi-bin/ezs3/json/smb_adcfg_get", data, successCallback, isGlobal);
}

function ajax_set_qos_policies(gateway_group, enable, policies, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        enable: enable,
        policies: policies
    };
    return ajax_post("/cgi-bin/ezs3/json/set_qos_policies", data, successCallback, isGlobal);
}

function ajax_get_qos_policies(gateway_group, rw, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        rw: rw
    };
    return ajax_get("/cgi-bin/ezs3/json/get_qos_policies", data, successCallback, isGlobal);
}

function ajax_search_file(gateway_group, filename, rw, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        filename: filename,
        rw: rw
    };
    return ajax_get("/cgi-bin/ezs3/json/search_file", data, successCallback, isGlobal);
}

function ajax_iscsi_add_qos(gateway_group, iscsi_id, target_id, size, qos_enabled, maxbw, maxiops,
                            snapshot_enabled, snapshot_interval_min, snapshot_since, snapshot_max,
                            successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        iscsi_id: iscsi_id,
        target_id: target_id,
        size: size,
        qos_enabled: qos_enabled,
        maxbw: maxbw,
        maxiops: maxiops,
        snapshot_enabled: snapshot_enabled,
        snapshot_interval_min: snapshot_interval_min,
        snapshot_since: snapshot_since,
        snapshot_max: snapshot_max
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_add", data, successCallback, isGlobal);
}

function ajax_get_qos_lowerbounds(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/get_qos_lowerbounds", {}, successCallback, isGlobal);
}

function ajax_sds_admin_edit(user_id, gwgroups, successCallback, isGlobal) {
    var data = {
        user_id: user_id,
        gwgroups: gwgroups
    };
    return ajax_post("/cgi-bin/ezs3/json/sds_admin_edit", data, successCallback, isGlobal);
}

function ajax_sds_admin_list(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/sds_admin_list", {}, successCallback, isGlobal);
}

function ajax_sds_admin_add(user_ids, gwgroups, successCallback, isGlobal) {
    var data = {
        user_ids: user_ids,
        gwgroups: gwgroups
    };
    return ajax_post("/cgi-bin/ezs3/json/sds_admin_add", data, successCallback, isGlobal);
}

function ajax_sds_admin_remove(user_ids, successCallback, isGlobal) {
    var data = { user_ids: user_ids };
    return ajax_post("/cgi-bin/ezs3/json/sds_admin_remove", data, successCallback, isGlobal);
}

function ajax_enable_fc_initiator(gateway_group, host, fc_wwpn, successCallback, errorCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        host: host,
        fc_wwpn: fc_wwpn,
        enabled: true
    };

    return ajax_get("/cgi-bin/ezs3/json/set_fc_initiator", data, successCallback, isGlobal, errorCallback);
}

function ajax_disable_fc_initiator(gateway_group, host, fc_wwpn, successCallback, errorCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        host: host,
        fc_wwpn: fc_wwpn,
        enabled: false
    };

    return ajax_get("/cgi-bin/ezs3/json/set_fc_initiator", data, successCallback, isGlobal, errorCallback);
}

function ajax_host_enclosure_info(host, successCallback, isGlobal) {
    var data = { host: host };
    return ajax_get("/cgi-bin/ezs3/json/host_enclosure_info", data, successCallback, isGlobal);
}

function ajax_disk_status_image(host, successCallback, isGlobal) {
    var data = { host: host };
    return ajax_get("/cgi-bin/ezs3/json/host_disk_status_image", data, successCallback, isGlobal);
}

function ajax_host_local_disk_list(host, successCallback, isGlobal) {
    var data = { host: host };
    return ajax_get("/cgi-bin/ezs3/json/host_local_disk_list", data, successCallback, isGlobal);
}

function ajax_host_create_raid_list(host, successCallback, isGlobal) {
    var data = { host: host
                 //storage_box: storage_box
    };
    return ajax_get("/cgi-bin/ezs3/json/host_create_raid_list", data, successCallback, isGlobal);
}
//create raid
function ajax_create_raid(host, storage_box, successCallback, isGlobal) {
    var data = { 
        host: host,
        storage_box: storage_box
    };
    return ajax_get("/cgi-bin/ezs3/json/create_raid", data, successCallback, isGlobal);
}
//erase raid
function ajax_erase_raid(host, storage_box, successCallback, isGlobal) {
    var data = { 
        host: host,
        storage_box: storage_box
    };
    return ajax_get("/cgi-bin/ezs3/json/erase_raid", data, successCallback, isGlobal);
}

function ajax_host_iscsi_disk_list(host, successCallback, isGlobal) {
    var data = { host: host };
    return ajax_get("/cgi-bin/ezs3/json/host_iscsi_disk_list", data, successCallback, isGlobal);
}

function ajax_host_nas_disk_list(host, successCallback, isGlobal) {
    var data = { host: host };
    return ajax_get("/cgi-bin/ezs3/json/host_nas_disk_list", data, successCallback, isGlobal);
}

function ajax_host_nas_disk_create(host, type, server, path, size, username, password, successCallback, isGlobal) {
    var data = {
        host: host, type: type, server: server, path: path, size: size,
        username: username, password: password
    };
    return ajax_get("/cgi-bin/ezs3/json/host_nas_disk_create", data, successCallback, isGlobal);
}

function ajax_host_nas_disk_destroy(host, idx, successCallback, isGlobal) {
    var data = { host: host, idx: idx };
    return ajax_get("/cgi-bin/ezs3/json/host_nas_disk_destroy", data, successCallback, isGlobal);
}

function ajax_host_iscsi_list(host, successCallback, isGlobal) {
    var data = { host: host };
    return ajax_get("/cgi-bin/ezs3/json/host_iscsi_list", data, successCallback, isGlobal);
}

function ajax_host_iscsi_list_target(host, iscsi_server, iscsi_port, isGlobal) {
    var data = { host: host, ip: iscsi_server, port: iscsi_port };
    return ajax_get("/cgi-bin/ezs3/json/host_iscsi_list_target", data, null, isGlobal, function(){});
}

function ajax_host_iscsi_login(gateway_group, host, ip, port, target, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        host: host,
        ip: ip,
        port: port,
        target: target
    };
    return ajax_get("/cgi-bin/ezs3/json/host_iscsi_login", data, successCallback, isGlobal);
}

function ajax_host_iscsi_logout(gateway_group, host, target, ip, port, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        host: host,
        target: target,
        ip: ip,
        port: port
    };
    return ajax_get("/cgi-bin/ezs3/json/host_iscsi_logout", data, successCallback, isGlobal);
}

function ajax_profile_name_check(profile_name, successCallback, isGlobal) {
    var data = {
    		profile_name: profile_name
        };
    return ajax_get("/cgi-bin/ezs3/json/profile_check_name", data, successCallback, isGlobal);
}

function ajax_hypervisor_fetch_information(hypervisor_type, authentication_info, successCallback, isGlobal) {
    var data = {
    		hypervisor_type: hypervisor_type,
    		authentication_info: authentication_info
        };
    return ajax_get("/cgi-bin/ezs3/json/hypervisor_fetch_information", data, successCallback, isGlobal);
}

function ajax_profile_create(profile_data, successCallback, isGlobal, errorCallback) {
	return ajax_post("/cgi-bin/ezs3/json/profile_create", profile_data, successCallback, isGlobal, errorCallback);
}

function ajax_profile_list(user, successCallback, isGlobal) {
    var data = {
    		user: user
        };
	return ajax_get("/cgi-bin/ezs3/json/profile_list", data, successCallback, isGlobal);
}

function ajax_profile_details_get(profile_id, successCallback, isGlobal) {
    var data = {
    		profile_id: profile_id
        };
    return ajax_get("/cgi-bin/ezs3/json/profile_details_get", data, successCallback, isGlobal);
}

function ajax_profile_delete(profile_id, successCallback, isGlobal) {
    var data = {
    		profile_id: profile_id
        };
	return ajax_get("/cgi-bin/ezs3/json/profile_delete", data, successCallback, isGlobal);
}

function ajax_profile_validate(profile_id, vm_amount, successCallback, isGlobal) {
    var data = {
            validate_profile: profile_id,
            vm_amount: vm_amount
        };
    return ajax_get("/cgi-bin/ezs3/json/profile_validate", data, successCallback, isGlobal);
}

function ajax_gateway_vm_create(group, profile_list, successCallback, isGlobal, errorCallback){
    var data = {
    		group: group,
    		profile_list: profile_list
        };
    return ajax_post("/cgi-bin/ezs3/json/gateway_vm_create", data, successCallback, isGlobal, errorCallback);
}

function ajax_gateway_vm_list(profile_id, successCallback, isGlobal) {
    var data = {
    		profile_id: profile_id
        };
    return ajax_get("/cgi-bin/ezs3/json/gateway_vm_list", data, successCallback, isGlobal);
}

function ajax_gateway_vm_details_get(profile_id, successCallback, isGlobal) {
    var data = {
    		profile_id: profile_id
        };
    return ajax_get("/cgi-bin/ezs3/json/gateway_vm_details_get", data, successCallback, isGlobal);
}

function ajax_gateway_vm_terminate(vm_list, successCallback, isGlobal) {
    var data = {
    		vm_list: vm_list
        };
    return ajax_get("/cgi-bin/ezs3/json/gateway_vm_terminate", data, successCallback, isGlobal);
}


function ajax_iscsi_add_md(gateway_group, target_id, src_gw, src_dev, dst_dev, dst_size, max_resync_speed, min_resync_speed, successCallback, isGlobal, errorCallback) {
    var data = {
        gateway_group: gateway_group,
        target_id: target_id,
        src_gw: src_gw,
        src_dev: src_dev,
        dst_dev: dst_dev,
        dst_size: dst_size,
        max_resync_speed: max_resync_speed,
        min_resync_speed: min_resync_speed
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_add_md", data, successCallback, isGlobal, errorCallback);
}

function ajax_iscsi_change_md(gateway_group, target_id, dst_dev, max_resync_speed, min_resync_speed, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        target_id: target_id,
        dst_dev: dst_dev,
        max_resync_speed: max_resync_speed,
        min_resync_speed: min_resync_speed
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_change_md", data, successCallback, isGlobal);
}

function ajax_iscsi_sync_md(gateway_group, target_id, dst_dev, successCallback, isGlobal, errorCallback) {
    var data = {
        gateway_group: gateway_group,
        target_id: target_id,
        dst_dev: dst_dev
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_sync_md", data, successCallback, isGlobal, errorCallback);
}

function ajax_iscsi_resync_md(gateway_group, target_id, dst_dev, successCallback, isGlobal, errorCallback) {
    var data = {
        gateway_group: gateway_group,
        target_id: target_id,
        dst_dev: dst_dev
    };
    return ajax_get("/cgi-bin/ezs3/json/iscsi_resync_md", data, successCallback, isGlobal, errorCallback);
}

function ajax_license_info_get(successCallback, isGlobal, errorCallback) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/license_info_get", data, successCallback, isGlobal, errorCallback);
}

function ajax_query_progress(ticket, successCallback, isGlobal, error_callback) {
    var data = {ticket: ticket};
    return ajax_get("/cgi-bin/ezs3/json/query_progress", data, successCallback, isGlobal, error_callback);
}

function ajax_query_is_in_cluster(successCallback) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/is_in_cluster", data, successCallback);
}

function ajax_storage_volume_list(host, successCallback, isGlobal) {
    var data = {host: host};
    return ajax_get("/cgi-bin/ezs3/json/storage_volume_list", data, successCallback, isGlobal);
}

function ajax_partition_list(host, successCallback, isGlobal) {
    var data = {host: host};
    return ajax_get("/cgi-bin/ezs3/json/partition_list", data, successCallback, isGlobal);
}

function ajax_storage_volume_add(host, name, sv_type, data_devs, journal_dev, cache_dev, spare_devs, dedup, compress, successCallback, isGlobal) {
    var data = {
        host: host,
        name: name,
        sv_type: sv_type,
        data_devs: JSON.stringify(data_devs),
        journal_dev: journal_dev,
        cache_dev: cache_dev,
        spare_devs: JSON.stringify(spare_devs),
        dedup: dedup,
        compress: compress
    };
    return ajax_post("/cgi-bin/ezs3/json/storage_volume_add", data, successCallback, isGlobal);
}

function ajax_storage_volume_edit(host, name, cache_dev, spare_devs, successCallback, isGlobal) {
    var data = {
        host: host,
        name: name,
        cache_dev: cache_dev,
        spare_devs: JSON.stringify(spare_devs)
    };
    return ajax_post("/cgi-bin/ezs3/json/storage_volume_edit", data, successCallback, isGlobal);
}

function ajax_storage_volume_remove(host, names, successCallback, isGlobal) {
    var data = {
        host: host,
        names: JSON.stringify(names)
    };
    return ajax_post("/cgi-bin/ezs3/json/storage_volume_remove", data, successCallback, isGlobal);
}

function ajax_storage_volume_scan(host, names, successCallback, isGlobal) {
    var data = {
        host: host,
        names: JSON.stringify(names)
    };
    return ajax_post("/cgi-bin/ezs3/json/storage_volume_scan", data, successCallback, isGlobal);
}

function ajax_storage_volume_reformat(host, names, successCallback, isGlobal) {
    var data = {
        host: host,
        names: JSON.stringify(names)
    };
    return ajax_post("/cgi-bin/ezs3/json/storage_volume_reformat", data, successCallback, isGlobal);
}

function ajax_host_nic_list(host, successCallback, isGlobal) {
    var data = { host: host };
    return ajax_get("/cgi-bin/ezs3/json/host_nic_list", data, successCallback, isGlobal);
}

function ajax_node_role_enable_osd(ip, sv_list, cluster_iface, public_iface, successCallback, isGlobal) {
    var data = {
        ip: ip,
        sv_list: sv_list.join(" "),
        cluster_iface: cluster_iface,
        public_iface: public_iface
    };
    return ajax_get("/cgi-bin/ezs3/json/node_role_enable_osd", data, successCallback, isGlobal);
}

function ajax_node_role_disable_osd(ip, sv_list, force, successCallback, isGlobal) {
    var data = {
        ip: ip,
        sv_list: sv_list.join(" "),
        force: force
    };
    return ajax_get("/cgi-bin/ezs3/json/node_role_disable_osd", data, successCallback, isGlobal);
}

function ajax_node_role_osd_progress(ip, enable, successCallback, isGlobal) {
    var data = {
        ip: ip,
        enable: enable
    };
    return ajax_get("/cgi-bin/ezs3/json/node_role_osd_progress", data, successCallback, isGlobal);
}

function ajax_gateway_role_enable(ip, public_iface, successCallback, isGlobal) {
    var data = {
        ip: ip,
        public_iface: public_iface
    };
    return ajax_get("/cgi-bin/ezs3/json/gateway_role_enable", data, successCallback, isGlobal);
}

function ajax_gateway_role_progress(ip, enable, successCallback, isGlobal) {
    var data = {
        ip: ip,
        enable: enable
    };
    return ajax_get("/cgi-bin/ezs3/json/gateway_role_progress", data, successCallback, isGlobal);
}

function ajax_gateway_role_disable(ip, successCallback, isGlobal) {
    var data = {
        ip: ip
    };
    return ajax_get("/cgi-bin/ezs3/json/gateway_role_disable", data, successCallback, isGlobal);
}

function ajax_node_roles(hosts, successCallback, isGlobal) {
    var data = {
        hosts: JSON.stringify(hosts)
    };
    return ajax_get("/cgi-bin/ezs3/json/node_roles", data, successCallback, isGlobal);
}

function ajax_ntp_server_get(successCallback, isGlobal) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/ntp_server_get", data, successCallback, isGlobal);
}

function ajax_ntp_server_set(server_list, successCallback, isGlobal) {
    var data = {
        server_list: server_list.join(" ")
    };
    return ajax_get("/cgi-bin/ezs3/json/ntp_server_set", data, successCallback, isGlobal);
}

function ajax_node_role_enable_rrs(ip, public_iface, successCallback, isGlobal) {
    var data = {
        ip: ip,
        public_iface: public_iface
    };
    return ajax_get("/cgi-bin/ezs3/json/node_role_enable_rrs", data, successCallback, isGlobal);
}

function ajax_node_role_disable_rrs(ip, successCallback, isGlobal) {
    var data = {
        ip: ip
    };
    return ajax_get("/cgi-bin/ezs3/json/node_role_disable_rrs", data, successCallback, isGlobal);
}

function ajax_node_role_rrs_progress(ip, enable, successCallback, isGlobal) {
    var data = {
        ip: ip,
        enable: enable
    };
    return ajax_get("/cgi-bin/ezs3/json/node_role_rrs_progress", data, successCallback, isGlobal);
}

function ajax_journal_partition_get(host, successCallback, isGlobal) {
    var data = { host: host };
    return ajax_get("/cgi-bin/ezs3/json/journal_partition_get", data, successCallback, isGlobal);
}

function ajax_journal_partition_edit(host, journal_dev, successCallback, isGlobal) {
    var data = {
        host: host,
        journal_dev: journal_dev
    };
    return ajax_get("/cgi-bin/ezs3/json/journal_partition_edit", data, successCallback, isGlobal);
}

function ajax_cluster_management_status(successCallback, isGlobal) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/cluster_management_status", data, successCallback, isGlobal);
}

function ajax_enable_maintenance_mode(successCallback, isGlobal) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/enable_maintenance_mode", data, successCallback, isGlobal);
}

function ajax_disable_maintenance_mode(successCallback, isGlobal) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/disable_maintenance_mode", data, successCallback, isGlobal);
}

function ajax_enable_incremental_recovery(successCallback, isGlobal) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/enable_incremental_recovery", data, successCallback, isGlobal);
}

function ajax_disable_incremental_recovery(successCallback, isGlobal) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/disable_incremental_recovery", data, successCallback, isGlobal);
}

function ajax_central_log_config_get(successCallback, isGlobal) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/central_log_config_get", data, successCallback, isGlobal);
}

function ajax_central_log_get(categories, events, severities, start_date, start_time, end_date, end_time, export_log, export_name, successCallback, isGlobal) {
    var data = {
        categories:categories,
        events:events,
        severities:severities,
        start_date:start_date,
        start_time:start_time,
        end_date:end_date,
        end_time:end_time,
        export_log:export_log,
        export_name:export_name
    };
    return ajax_get("/cgi-bin/ezs3/json/central_log_get", data, successCallback, isGlobal);
}

function ajax_central_log_detail_get(category, event_time, event_id, successCallback, isGlobal) {
    var data = {
        category:category,
        event_time:event_time,
        event_id:event_id
    };
    return ajax_get("/cgi-bin/ezs3/json/central_log_detail_get", data, successCallback, isGlobal);
}

function ajax_cluster_info(successCallback, isGlobal) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/cluster_info", data, successCallback, isGlobal);
}

function ajax_rbd_volume_list(host, successCallback, isGlobal) {
    var data = {
        host: host
    };
    return ajax_get("/cgi-bin/ezs3/json/rbd_volume_list", data, successCallback, isGlobal);
}

function ajax_rbd_volume_cache_create(host, rbd_img, pool_id, cache_path, successCallback, isGlobal) {
    var data = {
        host: host,
        rbd_img: rbd_img,
        pool_id: pool_id,
        cache_path: cache_path
    };
    return ajax_get("/cgi-bin/ezs3/json/rbd_volume_cache_create", data, successCallback, isGlobal);
}

function ajax_rbd_volume_cache_delete(host, cache_names, successCallback, isGlobal) {
    var data = {
        host: host,
        cache_names: JSON.stringify(cache_names)
    };
    return ajax_get("/cgi-bin/ezs3/json/rbd_volume_cache_delete", data, successCallback, isGlobal);
}

function ajax_cached_volume_list(host, successCallback, isGlobal) {
    var data = {
        host: host
    };
    return ajax_get("/cgi-bin/ezs3/json/cached_volume_list", data, successCallback, isGlobal);
}

function ajax_fs_cache_enable(host, cache_partition, is_partition, use_whole_disk, cache_size, successCallback, isGlobal) {
    var data = {
        host: host,
        cache_partition: cache_partition,
        is_partition: is_partition,
        use_whole_disk: use_whole_disk,
        cache_size: cache_size
    };
    return ajax_get("/cgi-bin/ezs3/json/fs_cache_enable", data, successCallback, isGlobal);
}

function ajax_fs_cache_disable(host, successCallback, isGlobal) {
    var data = {
        host: host
    };
    return ajax_get("/cgi-bin/ezs3/json/fs_cache_disable", data, successCallback, isGlobal);
}

function ajax_fs_cache_status(host, successCallback, isGlobal) {
    var data = {
        host: host
    };
    return ajax_get("/cgi-bin/ezs3/json/fs_cache_status", data, successCallback, isGlobal);
}

function ajax_sds_qos_get(gateway_group, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group
    };
    return ajax_get("/cgi-bin/ezs3/json/sds_qos_get", data, successCallback, isGlobal);
}

function ajax_sds_qos_set(gateway_group, enabled, read_maxbw, read_maxiops, write_maxbw, write_maxiops, successCallback, isGlobal) {
    var data = {
        gateway_group: gateway_group,
        enabled: enabled,
        read_maxbw: read_maxbw,
        read_maxiops: read_maxiops,
        write_maxbw: write_maxbw,
        write_maxiops: write_maxiops
    };
    return ajax_get("/cgi-bin/ezs3/json/sds_qos_set", data, successCallback, isGlobal);
}

function ajax_event_get(successCallback, isGlobal, errorCallback) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/event_get", data, successCallback, isGlobal, errorCallback);
}

function ajax_historical_statistic_get(category, resolution, end, range, cf, successCallback, isGlobal) {
    var data = {
        category: category,
        fetch_type: 'historical',
        resolution: resolution,
        end: end,
        range: range,
        cf: cf
    };
    return ajax_get("/cgi-bin/ezs3/json/historical_statistic", data, successCallback, isGlobal);
}

function ajax_last_statistic_get(category, resolution, cf, successCallback, isGlobal) {
    var data = {
        category: category,
        fetch_type: 'last',
        resolution: resolution,
        cf: cf
    };
    return ajax_get("/cgi-bin/ezs3/json/historical_statistic", data, successCallback, isGlobal);
}

function ajax_sds_du_list(success_cb, is_global) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/sds_du_list", data, success_cb, is_global);
}

function ajax_fc_list_ports(ip, success_cb, is_global) {
    var data = {ip: ip};
    return ajax_get("/cgi-bin/ezs3/json/fc_list_ports", data, success_cb, is_global);
}

function ajax_host_feature_type(host, success_cb, is_global) {
    var data = {host: host};
    return ajax_get("/cgi-bin/ezs3/json/host_feature_type", data, success_cb, is_global);
}

function ajax_converger_config_modify(vcenter_server, vcenter_username, vcenter_password, success_cb, is_global) {
    var data = {
        vcenter_server: vcenter_server,
        vcenter_username: vcenter_username,
        vcenter_password: vcenter_password
    };
    return ajax_get("/cgi-bin/ezs3/json/converger_config_modify", data, success_cb, is_global);
}

function ajax_converger_config_get(success_cb, is_global) {
    var data = {};
    return ajax_get("/cgi-bin/ezs3/json/converger_config_get", data, success_cb, is_global);
}

function ajax_software_info(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/software_info", {}, successCallback, isGlobal);
}

function ajax_exported_central_log_list(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/exported_central_log_list", {}, successCallback, isGlobal);
}

function ajax_exported_central_log_delete(export_id, successCallback, isGlobal) {
    var data = {
        export_id: export_id
    };
    return ajax_get("/cgi-bin/ezs3/json/exported_central_log_delete", data, successCallback, isGlobal);
}

function ajax_osd_recovery_qos_get(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/osd_recovery_qos_get", {}, successCallback, isGlobal);
}

function ajax_osd_recovery_qos_set(enabled, recovery_maxbw, successCallback, isGlobal) {
    var data = {
        enabled: enabled,
        recovery_maxbw: recovery_maxbw
    };
    return ajax_get("/cgi-bin/ezs3/json/osd_recovery_qos_set", data, successCallback, isGlobal);
}

function ajax_set_timezone(timezone, successCallback, isGlobal) {
    var data = {
        timezone: timezone
    };
    return ajax_get("/cgi-bin/ezs3/json/timezone_set", data, successCallback, isGlobal);
}

function ajax_get_timezone(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/timezone_get", {}, successCallback, isGlobal);
}

function ajax_get_rack_aware_status(successCallback, isGlobal) {
    return ajax_get("/cgi-bin/ezs3/json/get_rack_aware_status", {}, successCallback, isGlobal);
}

function ajax_set_rackid(rack_id, successCallback, isGlobal) {
    var data = {
        rack_id: rack_id
    };
    return ajax_get("/cgi-bin/ezs3/json/set_rackid", data, successCallback, isGlobal);
}

