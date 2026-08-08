import * as fs from 'fs'
import * as path from 'path'

export interface BrokerLogonField {
  name: string
  tag: number
  type: string
}

/**
 * Tags a counterparty demands on the Logon that standard FIX 4.4 does not carry.
 * `Account` is the case from jspurefix issue #93; `DefaultApplVerID` is #96 and #39.
 *
 * The two are missing in different ways, which is the point of showing both.
 * `Account` already exists in the FIX 4.4 field table - it simply has no place on
 * the Logon message.  `DefaultApplVerID` belongs to FIXT.1.1 and is not in FIX 4.4
 * at all, so it needs declaring before it can be used.
 *
 * Either way the engine encodes against the dictionary: a key it cannot resolve to
 * a field of the message being encoded has no tag to be written to, so it is
 * dropped - and that, not the session code, is why a bespoke Logon tag usually
 * never reaches the wire.
 */
export const brokerLogonFields: BrokerLogonField[] = [
  { name: 'Account', tag: 1, type: 'STRING' },
  { name: 'DefaultApplVerID', tag: 1137, type: 'STRING' }
]

const generated = 'FIX44-BROKER.xml'

/**
 * Build a dictionary that admits those fields onto Logon, from the FIX 4.4 QuickFIX
 * XML that ships inside jspurefix.
 *
 * Doing it in code keeps the demo honest - you can read exactly what surgery a
 * "custom dictionary" amounts to - and saves checking a 320KB near duplicate of the
 * standard file into this repository.  In your own project you would simply keep the
 * edited XML alongside your source.
 *
 * Returns the absolute path of the dictionary, which is what the session description
 * should carry.  A *relative* dictionary path is resolved by jspurefix against its
 * own package root, not your working directory - the single most common reason a
 * custom dictionary appears to be ignored.
 */
export function ensureBrokerDictionary (dataDir: string): string {
  const target = path.join(dataDir, generated)
  const source = standardFix44()

  if (fs.existsSync(target) && fs.statSync(target).mtimeMs > fs.statSync(source).mtimeMs) {
    return target
  }

  let xml = fs.readFileSync(source, 'utf8')
  xml = declareFields(xml)
  xml = addToLogon(xml, source)

  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(target, xml, 'utf8')

  console.log(`  generated ${path.relative(process.cwd(), target)} from the FIX 4.4 dictionary bundled with jspurefix`)
  console.log(`  added to <message name='Logon'>: ${brokerLogonFields.map(f => `${f.name} (${f.tag})`).join(', ')}`)
  return target
}

/** a field can only be used once the <fields> table declares its tag and type */
function declareFields (xml: string): string {
  const missing = brokerLogonFields
    .filter(f => !xml.includes(`<field number='${f.tag}' name='${f.name}'`))
    .map(f => `  <field number='${f.tag}' name='${f.name}' type='${f.type}' />\n`)
    .join('')
  return missing ? xml.replace('\n </fields>', `\n${missing} </fields>`) : xml
}

/** ... and it only reaches the wire once the message itself lists it */
function addToLogon (xml: string, source: string): string {
  // attribute order varies between dictionaries, so find it by name alone
  const open = xml.indexOf("<message name='Logon'")
  const close = open >= 0 ? xml.indexOf('</message>', open) : -1
  if (close < 0) {
    throw new Error(`cannot find the Logon message in ${source}`)
  }
  const body = xml.substring(open, close)
  const added = brokerLogonFields
    .filter(f => !body.includes(`name='${f.name}'`))
    .map(f => `   <field name='${f.name}' required='N' />\n`)
    .join('')
  return `${xml.substring(0, close)}${added}${xml.substring(close)}`
}

/** the QuickFIX FIX 4.4 XML bundled with the installed jspurefix */
function standardFix44 (): string {
  const root = path.dirname(require.resolve('jspurefix/package.json'))
  const dictionary = require(path.join(root, 'data/dictionary.json'))
  return path.join(root, dictionary.qf44.dict)
}
