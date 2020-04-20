import { Command, format, HelpError, getSchemaPath, arg } from '@prisma/sdk'
import chalk from 'chalk'
import path from 'path'
import {
  IntrospectionEngine,
  IntrospectionWarnings,
  uriToCredentials,
} from '@prisma/sdk'
import { formatms } from '../util/formatms'
import fs from 'fs'
import { databaseTypeToConnectorType } from '@prisma/sdk/dist/convertCredentials'
import { printDatasources } from '../prompt/utils/printDatasources'
import Debug from 'debug'
const debug = Debug('Introspect')

/**
 * $ prisma introspect
 */
export class Introspect implements Command {
  public static new(): Introspect {
    return new Introspect()
  }

  // static help template
  private static help = format(`
    Introspect a database and save the result to schema.prisma.

    ${chalk.bold('Usage')}

    With an existing schema.prisma
      ${chalk.dim('$')} prisma introspect

    Or specify a schema:
      ${chalk.dim('$')} prisma introspect --schema=./schema.prisma'

    Instead of saving the result to the filesystem, you can also print it
      ${chalk.dim('$')} prisma introspect --print'

  `)

  private printUrlAsDatasource(url: string): string {
    const connectorType = databaseTypeToConnectorType(
      uriToCredentials(url).type,
    )

    return printDatasources([
      {
        config: {},
        connectorType,
        name: 'db',
        url,
      },
    ])
  }

  // parse arguments
  public async parse(argv: string[]): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--url': String,
      '--print': Boolean,
      '--schema': String,
    })

    const log = (...messages): void => {
      if (!args['--print']) {
        console.log(...messages)
      }
    }

    if (args instanceof Error) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    const url: string | undefined = args['--url']
    let schemaPath = await getSchemaPath(args['--schema'])
    if (!url && !schemaPath) {
      throw new Error(
        `Either provide ${chalk.greenBright(
          '--schema',
        )} or make sure that you are in a folder with a ${chalk.greenBright(
          'schema.prisma',
        )} file.`,
      )
    }
    // TS at its limits 🤷‍♀️
    const schema: string = url
      ? this.printUrlAsDatasource(url)
      : schemaPath
      ? fs.readFileSync(schemaPath, 'utf-8')
      : undefined!

    const engine = new IntrospectionEngine({
      cwd: schemaPath ? path.dirname(schemaPath) : undefined,
    })

    const basedOn =
      !args['--url'] && schemaPath
        ? ` based on datasource defined in ${chalk.underline(
            path.relative(process.cwd(), schemaPath),
          )}`
        : ''
    log(`\nIntrospecting${basedOn} …`)

    const before = Date.now()
    let introspectionSchema = ''
    let introspectionWarnings: IntrospectionWarnings[]
    try {
      const introspectionResult = await engine.introspect(schema)
      introspectionSchema = introspectionResult.datamodel
      introspectionWarnings = introspectionResult.warnings
    } catch (e) {
      if (e.code === 'P4001') {
        if (introspectionSchema.trim() === '') {
          throw new Error(`\n${chalk.red.bold('P4001 ')}${chalk.red(
            'The introspected database was empty:',
          )} ${url ? chalk.underline(url) : ''}

${chalk.bold(
  'prisma introspect',
)} could not create any models in your ${chalk.bold(
            'schema.prisma',
          )} file and you will not be able to generate Prisma Client with the ${chalk.bold(
            'prisma generate',
          )} command.

${chalk.bold('To fix this, you have two options:')}

- manually create a table in your database (using SQL).
- make sure the database connection URL inside the ${chalk.bold(
            'datasource',
          )} block in ${chalk.bold(
            'schema.prisma',
          )} points to a database that is not empty (it must contain at least one table).

Then you can run ${chalk.green('prisma introspect')} again. 
`)
        }
      }

      throw e
    }

    function getWarningMessage(
      warnings: IntrospectionWarnings[],
    ): string | undefined {
      if (warnings.length > 0) {
        let message = `\n*** WARNING ***\n`

        for (const warning of warnings) {
          message += `\n${warning.message}\n`

          if (warning.code === 1) {
            message += warning.affected
              .map((it) => `- "${it.model}"`)
              .join('\n')
          } else if (warning.code === 2) {
            const modelsGrouped: {
              [key: string]: string[]
            } = warning.affected.reduce((acc, it) => {
              if (!acc[it.model]) {
                acc[it.model] = []
              }
              acc[it.model].push(it.field)
              return acc
            }, {})
            message += Object.entries(modelsGrouped)
              .map(
                ([model, fields]) =>
                  `- Model: "${model}"\n  Field(s): "${fields.join('", "')}"`,
              )
              .join('\n')
          } else if (warning.code === 3) {
            message += warning.affected
              .map(
                (it) =>
                  `- Model: "${it.model}" Field: "${it.field}" Raw Datatype: "${it.tpe}"`,
              )
              .join('\n')
          } else if (warning.code === 4) {
            message += warning.affected
              .map((it) => `- Enum: "${it.enm}" Value: "${it.value}"`)
              .join('\n')
          }

          message += `\n`
        }
        return message
      }
    }

    const introspectionWarningsMessage = getWarningMessage(
      introspectionWarnings,
    )

    if (args['--print']) {
      console.log(introspectionSchema)
      introspectionWarnings && console.error(introspectionWarnings)
    } else {
      schemaPath = schemaPath || 'schema.prisma'
      fs.writeFileSync(schemaPath, introspectionSchema)

      log(`\n✔ Wrote Prisma data model into ${chalk.underline(
        path.relative(process.cwd(), schemaPath),
      )} in ${chalk.bold(formatms(Date.now() - before))}
      ${chalk.keyword('orange')(introspectionWarningsMessage)}
Run ${chalk.green('prisma generate')} to generate Prisma Client.`)
    }

    engine.stop()

    return ''
  }

  // help message
  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(
        `\n${chalk.bold.red(`!`)} ${error}\n${Introspect.help}`,
      )
    }
    return Introspect.help
  }
}
