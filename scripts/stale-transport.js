#!/usr/bin/env node
/*
 * Reproduction driver for https://github.com/TimelordUK/jspurefix/issues/153.
 *
 * A counterparty logs on, then its socket goes half open - the peer is gone but no
 * FIN or RST ever arrives, so the acceptor has no way to know.  The counterparty
 * reconnects and logs on again with the same CompID.
 *
 * A real half open socket needs the network path to disappear (a firewall drop, a
 * NAT timeout); killing a process does not produce one, because the kernel still
 * closes its file descriptors.  So this script plays the counterparty itself: it
 * opens a raw socket, sends a valid Logon, and then simply stops participating -
 * never reading, never writing, never closing.  From the acceptor's point of view
 * that is indistinguishable from the reported failure.
 *
 * A correct acceptor must end up with exactly one live session for the CompID, and
 * it must be the new one.
 *
 * Usage: node scripts/stale-transport.js [--port 2345] [--sender init-comp]
 */
const net = require('net')

const SOH = '\x01'

function arg (name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const port = parseInt(arg('--port', '2345'), 10)
const host = arg('--host', 'localhost')
const sender = arg('--sender', 'init-comp')
const target = arg('--target', 'accept-comp')

function sendingTime () {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`
}

/**
 * Hand rolled so the script depends on nothing - the point is to behave like a
 * counterparty the engine has no control over.  ResetSeqNumFlag=Y keeps the
 * scenario repeatable against a persisted store.
 */
function logon (seqNum) {
  const body = [
    '35=A',
    `49=${sender}`,
    `56=${target}`,
    `34=${seqNum}`,
    '57=fix',
    `52=${sendingTime()}`,
    '98=0',
    '108=30',
    '141=Y',
    '553=js-client',
    '554=pwd-client'
  ].join(SOH) + SOH

  const head = `8=FIX4.4${SOH}9=${body.length}${SOH}`
  const withoutChecksum = head + body
  let sum = 0
  for (let i = 0; i < withoutChecksum.length; ++i) sum += withoutChecksum.charCodeAt(i)
  const checksum = String(sum % 256).padStart(3, '0')
  return `${withoutChecksum}10=${checksum}${SOH}`
}

function connectAndLogon (label, { goSilent }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host, () => {
      console.log(`[${label}] connected from ${socket.localAddress}:${socket.localPort}`)
      socket.write(logon(1))
      console.log(`[${label}] sent Logon for ${sender}`)
      if (goSilent) {
        // stop reading.  The socket stays open at the OS level and the process holds
        // it, so the acceptor sees a peer that is connected but has stopped talking.
        socket.pause()
        console.log(`[${label}] going silent - socket held open, no further traffic`)
      } else {
        socket.on('data', (d) => {
          const first = d.toString().split(SOH).find(f => f.startsWith('35='))
          console.log(`[${label}] received ${first ?? '(partial)'}`)
        })
      }
      resolve(socket)
    })
    socket.on('error', reject)
  })
}

async function main () {
  console.log(`stale transport scenario against ${host}:${port} as ${sender}`)

  const stale = await connectAndLogon('client-1', { goSilent: true })
  await new Promise(r => setTimeout(r, 3000))

  console.log('')
  console.log('--- counterparty reconnects on a fresh socket, same CompID ---')
  const live = await connectAndLogon('client-2', { goSilent: false })
  await new Promise(r => setTimeout(r, 5000))

  console.log('')
  console.log(`client-1 socket destroyed=${stale.destroyed} (the acceptor should have ended its session)`)
  console.log(`client-2 socket destroyed=${live.destroyed} (should be false - this session is the live one)`)

  stale.destroy()
  live.destroy()
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e.message)
  process.exit(1)
})
