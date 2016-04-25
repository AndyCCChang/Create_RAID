import time
import subprocess
import shlex
import tempfile
import psutil
import os
from ezs3 import remote
from ezs3.log import EZLog

logger = EZLog.get_logger(__name__)

class DoCommandTimedOut(RuntimeError):
    pass


class DoCommandError(RuntimeError):
    def __init__(self, stderr, errno=0, stdout=''):
        RuntimeError.__init__(self, stderr)
        self.errno, self.stdout, self.stderr = errno, stdout, stderr

    def __str__(self):
        return "DoCommandError: errno {} stdout '{}' stderr '{}'" \
               .format(self.errno, self.stdout, self.stderr)


@remote.callable
def do_cmd_cliib(cmd, timeout=0, force=False):
    logger.info("do_cmd_cliib start")
    logger.debug(u"command '{}' (timeout={}, force={})"
                 .format(cmd, timeout, force))
    d = dict(os.environ)
    d['PATH'] = '/promise/bin:/sbin:/usr/sbin:/bin:/usr/bin:/usr/local/bin:/usr/local/sbin'
    d['LD_LIBRARY_PATH'] = '/promise/lib'
    d['SW_CONF_PATH'] = '/promise/bin'
    logger.info("d: %s", d)
    cmdstr = cmd.encode('utf-8')
    logger.info("cmdstr: %s", cmdstr)
    if timeout <= 0:
        logger.info("do_cmd_cliib timeout <0")
        p = subprocess.Popen([cmdstr],
                             stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE,
                             shell=True,
                             env=d,
                             close_fds=True)
        (output, err) = p.communicate()
        logger.info("p: %s", p)
        logger.info("output:")
        logger.info(output)
    else:
        with tempfile.TemporaryFile('w+') as outfp:
            with tempfile.TemporaryFile('w+') as errfp:
                logger.info("do_cmd_cliib tempfile.TemporaryFile")
                p = subprocess.Popen([cmdstr],
                                     stdout=outfp,
                                     stderr=errfp,
                                     shell=True,
                                     close_fds=True,
                                     env=d
                                     )
                while p.poll() is None:
                    t = min(timeout, 0.1)
                    time.sleep(t)
                    timeout -= t
                    if timeout <= 0:
                        logger.debug(
                            "killing process %d and its child processes", p.pid
                        )
                        proc = psutil.Process(p.pid)
                        for c in proc.children(recursive=True):
                            c.kill()
                        proc.kill()
                        if force:
                            logger.warning(u"command '{}' timeout".format(cmd))
                            return ""
                        else:
                            raise DoCommandTimedOut(
                                u"command '{}' timeout".format(cmd)
                            )

                outfp.flush()   # don't know if this is needed
                outfp.seek(0)
                output = outfp.read()
                errfp.flush()   # don't know if this is needed
                errfp.seek(0)
                err = errfp.read()
    logger.info("p.returncode: %d", p.returncode)
    # prevent UnicodeDecodeError if invalid char in error/output
    err_str = unicode(err, 'utf-8', 'ignore')
    out_str = unicode(output, 'utf-8', 'ignore')
    if p.returncode != 0:
        if force:
            logger.warning(u"command '{}' failed: {} ({})"
                           .format(cmd, err_str, p.returncode))
            return ""
        else:
            raise DoCommandError(err, p.returncode, output)

    logger.debug(u"command '{}' returns '{}'".format(cmd, out_str))
    
    logger.info("output: %s", output)

    return output

@remote.callable
def do_cmd(cmd, timeout=0, force=False):
    logger.debug(u"command '{}' (timeout={}, force={})"
                 .format(cmd, timeout, force))

    cmdstr = cmd.encode('utf-8')
    if timeout <= 0:
        p = subprocess.Popen([cmdstr],
                             stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE,
                             shell=True,
                             close_fds=True)
        (output, err) = p.communicate()
    else:
        with tempfile.TemporaryFile('w+') as outfp:
            with tempfile.TemporaryFile('w+') as errfp:
                p = subprocess.Popen([cmdstr],
                                     stdout=outfp,
                                     stderr=errfp,
                                     shell=True,
                                     close_fds=True)
                while p.poll() is None:
                    t = min(timeout, 0.1)
                    time.sleep(t)
                    timeout -= t
                    if timeout <= 0:
                        logger.debug(
                            "killing process %d and its child processes", p.pid
                        )
                        proc = psutil.Process(p.pid)
                        for c in proc.children(recursive=True):
                            c.kill()
                        proc.kill()
                        if force:
                            logger.warning(u"command '{}' timeout".format(cmd))
                            return ""
                        else:
                            raise DoCommandTimedOut(
                                u"command '{}' timeout".format(cmd)
                            )

                outfp.flush()   # don't know if this is needed
                outfp.seek(0)
                output = outfp.read()
                errfp.flush()   # don't know if this is needed
                errfp.seek(0)
                err = errfp.read()

    # prevent UnicodeDecodeError if invalid char in error/output
    err_str = unicode(err, 'utf-8', 'ignore')
    out_str = unicode(output, 'utf-8', 'ignore')
    if p.returncode != 0:
        if force:
            logger.warning(u"command '{}' failed: {} ({})"
                           .format(cmd, err_str, p.returncode))
            return ""
        else:
            raise DoCommandError(err, p.returncode, output)

    logger.debug(u"command '{}' returns '{}'".format(cmd, out_str))

    return output


# callback must return strings from stdout and stderr
def do_cmd_with_progress(cmd, callback):
    cmdstr = cmd.encode('utf-8')
    p = subprocess.Popen(shlex.split(cmdstr),
                         stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE,
                         bufsize=1,
                         close_fds=True)
    out_str = ''
    err_str = ''
    while p.poll() is None:
        out_str, err_str = callback(p)
    if p.returncode != 0:
        raise DoCommandError(err_str, p.returncode, out_str)
    return out_str
