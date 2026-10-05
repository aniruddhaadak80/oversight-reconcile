import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildToolRegistry, createContext } from './bootstrap.js'
import { productTools } from './tools.js'
import { resolvePaths } from './paths.js'

const CONTEXT = createContext('test')

/** The repository root, so a test that reads plugins reads the real shipped ones. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('the one registry', () => {
  it('registers every product tool under an MCP-safe name', () => {
    const registry = buildToolRegistry(REPO_ROOT)
    expect(registry.names()).toEqual([
      'compare_runs',
      'ingest_document',
      'list_claims',
      'list_documents',
      'list_obligations',
      'list_plugins',
      'list_runs',
      'list_skills',
      'parse_claims',
      'reconcile_oversight',
    ])
    for (const name of registry.names()) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('exposes at least five tools, which is the product contract', () => {
    expect(buildToolRegistry(REPO_ROOT).size).toBeGreaterThanOrEqual(5)
  })

  it('gives every tool a description a model can act on', () => {
    for (const tool of buildToolRegistry(REPO_ROOT).list()) {
      expect(tool.description.length).toBeGreaterThan(60)
      expect(tool.description).toMatch(/[.!]$/)
      expect(tool.outputSchema).toHaveProperty('type', 'object')
      expect(tool.inputSchema).toHaveProperty('type', 'object')
    }
  })

  it('declares permissions for every tool and never asks for the network', () => {
    for (const tool of buildToolRegistry(REPO_ROOT).list()) {
      expect(tool.permissions.length).toBeGreaterThan(0)
      expect(tool.permissions).not.toContain('net:fetch')
      expect(tool.permissions).not.toContain('secrets:read')
    }
  })

  it('marks every tool as coming from core, and nothing else', () => {
    const registry = buildToolRegistry(REPO_ROOT)
    for (const name of registry.names()) {
      expect(registry.surfaceOf(name)).toBe('core')
      expect(registry.sourceOf(name)).toBe('core')
    }
  })

  it('refuses a duplicate registration rather than silently replacing a tool', () => {
    const registry = buildToolRegistry(REPO_ROOT)
    const [first] = productTools(resolvePaths(REPO_ROOT))
    expect(first).toBeDefined()
    expect(() => registry.register(first!, { source: 'plugin:impostor' })).toThrowError(/already registered/)
  })

  it('is a fresh registry each time, so a test cannot leak into the next', () => {
    expect(buildToolRegistry(REPO_ROOT)).not.toBe(buildToolRegistry(REPO_ROOT))
  })
})

describe('tool boundary validation', () => {
  it('rejects a missing required field before the handler runs', async () => {
    const registry = buildToolRegistry(REPO_ROOT)
    await expect(
      registry.invoke('ingest_document', {}, CONTEXT, ['fs:read', 'fs:write', 'proc:spawn']),
    ).rejects.toThrowError(/path/)
  })

  it('rejects an empty required string before spawning the engine', async () => {
    const registry = buildToolRegistry(REPO_ROOT)
    await expect(registry.invoke('parse_claims', { text: '' }, CONTEXT, ['proc:spawn'])).rejects.toThrowError(
      /text/,
    )
  })

  it('rejects a non-array where the engine expects a list', async () => {
    const registry = buildToolRegistry(REPO_ROOT)
    await expect(
      registry.invoke('reconcile_oversight', { claims: 'nope', obligations: [], evidence: [] }, CONTEXT, [
        'proc:spawn',
      ]),
    ).rejects.toThrowError(/claims/)
  })

  it('refuses a tool whose permissions were not granted', async () => {
    const registry = buildToolRegistry(REPO_ROOT)
    await expect(registry.invoke('list_documents', {}, CONTEXT, [])).rejects.toThrowError(/permissions/)
  })

  it('answers a read-only tool with real data from the shipped plugins', async () => {
    const registry = buildToolRegistry(REPO_ROOT)
    const value = await registry.invoke('list_obligations', {}, CONTEXT, ['fs:read'])
    const result = value as { count: number; packs: { framework: string }[] }
    expect(result.count).toBeGreaterThan(0)
    expect(result.packs.map((pack) => pack.framework)).toContain('EU AI Act')
    expect(result.packs.map((pack) => pack.framework)).toContain('NIST AI RMF 1.0')
  })
})
