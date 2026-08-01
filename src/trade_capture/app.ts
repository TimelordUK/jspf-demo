import 'reflect-metadata'

import * as fs from 'fs'
import * as path from 'path'

import { TradeCaptureServer } from './trade-capture-server'
import { TradeCaptureClient } from './trade-capture-client'
import { EngineFactory, IJsFixConfig, ISessionDescription, SessionLauncher } from 'jspurefix'
import { CliOptions, getConfigPaths, parseCliOptions, storeDirectories } from './cli'

class AppLauncher extends SessionLauncher {
  public constructor (
    client: string | ISessionDescription | null,
    server: string | ISessionDescription | null
  ) {
    super(client, server)
    this.root = __dirname
  }

  protected override makeFactory (config: IJsFixConfig): EngineFactory {
    const isInitiator = this.isInitiator(config.description)
    return {
      // take the config handed to us rather than closing over the launcher's.  An
      // acceptor resolves each accepted connection from its own scope, so this is
      // that session's own description, store and message factory - without it
      // every client on a multi-client acceptor would share one identity.
      makeSession: (sessionConfig: IJsFixConfig) => isInitiator
        ? new TradeCaptureClient(sessionConfig)
        : new TradeCaptureServer(sessionConfig)
    } as EngineFactory
  }
}

function loadDescription (relativePath: string): any {
  return JSON.parse(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'))
}

function withStore (description: any, store?: string): ISessionDescription {
  if (store) {
    description.store = { ...description.store, type: 'file', directory: store }
  }
  return description as ISessionDescription
}

/**
 * Each client in a multi-client run needs its own SenderCompId, otherwise they all
 * present the same identity and the acceptor's session registry - quite correctly -
 * stops each one as the next logs on.  Mirrors the C# demo, which suffixes
 * SenderCompID with _1.._n.
 */
function clientDescription (relativePath: string, index: number, total: number, store?: string): ISessionDescription {
  const description = loadDescription(relativePath)
  if (total > 1) {
    description.SenderCompId = `${description.SenderCompId}_${index}`
    description.application.name = `${description.application.name}_${index}`
  }
  return withStore(description, store)
}

function clearStores (): void {
  storeDirectories.forEach(dir => {
    const full = path.join(__dirname, '../..', dir)
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true })
      console.log(`cleared ${dir}`)
    }
  })
  console.log('stores cleared')
}

function launch (opts: CliOptions): void {
  const paths = getConfigPaths(opts)

  console.log(`mode: ${opts.mode}, client: ${paths.client != null}, server: ${paths.server != null}, clients: ${opts.clients}`)
  if (opts.store) console.log(`store override: ${opts.store}`)

  if (opts.disconnectAfter != null) {
    TradeCaptureClient.disconnectAfterSeconds = opts.disconnectAfter
  }

  const launchers: AppLauncher[] = []

  // The acceptor gets its own launcher so it keeps listening after any one client
  // goes away - a launcher given both roles ends when its client ends.
  if (paths.server) {
    launchers.push(new AppLauncher(null, withStore(loadDescription(paths.server), opts.store)))
  }

  if (paths.client) {
    for (let i = 1; i <= opts.clients; ++i) {
      launchers.push(new AppLauncher(clientDescription(paths.client, i, opts.clients, opts.store), null))
    }
  }

  if (opts.timeout != null) {
    setTimeout(() => {
      console.log(`timeout after ${opts.timeout}s, shutting down`)
      process.exit(0)
    }, opts.timeout * 1000)
  }

  // stagger the starts so the acceptor is listening first, and so a multi-client
  // run does not arrive as one connection storm
  launchers.forEach((launcher, i) => {
    setTimeout(() => {
      launcher.exec()
    }, i * 300)
  })
}

const opts = parseCliOptions()
if (opts.mode === 'clear') {
  clearStores()
} else {
  launch(opts)
}
