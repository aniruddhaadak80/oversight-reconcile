# Documentation

| Page                                     | Read it when                              |
| ---------------------------------------- | ----------------------------------------- |
| [getting-started.md](getting-started.md) | you have just cloned this                 |
| [architecture.md](architecture.md)       | you need the map before changing anything |
| [cli.md](cli.md)                         | you are scripting the CLI                 |
| [mcp.md](mcp.md)                         | you are connecting an agent               |
| [skills.md](skills.md)                   | you are writing or editing a skill        |
| [plugins.md](plugins.md)                 | you are adding a framework or extension   |
| [configuration.md](configuration.md)     | you are changing behaviour                |
| [troubleshooting.md](troubleshooting.md) | something is broken                       |
| [ci.md](ci.md)                           | you are adding a gate                     |
| [adr/](adr/)                             | you want the reasoning behind a decision  |
| [notes/](notes/)                         | you want the engineering notes            |

## The four decisions worth reading

- [0001 the narrow waist](adr/0001-narrow-waist.md) — why there is one registry and every
  surface is a transport.
- [0002 the Python engine boundary](adr/0002-python-engine-boundary.md) — why the parts that must
  be exactly right are a separate pure package.
- [0003 a self-contained web app](adr/0003-web-app-self-contained.md) — why `apps/web` has no
  workspace dependencies.
- [0004 provenance is the currency](adr/0004-provenance-as-the-currency.md) — why a claim carries
  byte offsets and why the report is a committed artifact. This is the decision that makes the
  product an oversight tool rather than a summariser.
