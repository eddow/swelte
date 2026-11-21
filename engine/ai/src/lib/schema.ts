// Phase A: schema identity shared by tool args, structured outputs, app
// events and trace decoding. One identity pins the shape for a run lifetime;
// unsupported V wire types fail generation instead of degrading silently.
export type SchemaVersion = `${number}`

export interface SchemaIdentity {
	/** Stable identity, e.g. `inspection.card`. */
	name: string
	/** Version pinned for the run lifetime, e.g. `3`. */
	version: SchemaVersion
}

export function schemaId(id: SchemaIdentity): string {
	return `${id.name}/${id.version}`
}

// Supported V wire types: the subset that generates versioned JSON Schema
// and TS representations (docs/types.md projection surface).
export type WireScalar = 'string' | 'boolean' | 'number' | 'blob' | 'epoch'
export type WireFieldType =
	| { scalar: WireScalar; nullable: boolean; optional: boolean }
	| { array: WireFieldType; nullable: boolean; optional: boolean }
	| { record: WireFieldType; nullable: boolean; optional: boolean }

export interface WireStruct {
	name: string
	fields: Record<string, WireFieldType>
}

export interface GeneratedSchema {
	identity: SchemaIdentity
	jsonSchema: Record<string, unknown>
	typeScript: string
}

const SCALAR_TS: Record<WireScalar, string> = {
	string: 'string',
	boolean: 'boolean',
	number: 'number',
	blob: 'Blob',
	epoch: 'number',
}

const SCALAR_JSON: Record<WireScalar, Record<string, string>> = {
	string: { type: 'string' },
	boolean: { type: 'boolean' },
	number: { type: 'number' },
	blob: { type: 'string', format: 'blob' },
	epoch: { type: 'integer', format: 'epoch' },
}

function fieldToJson(f: WireFieldType): Record<string, unknown> {
	const inner =
		'scalar' in f
			? { ...SCALAR_JSON[f.scalar] }
			: 'array' in f
				? { type: 'array', items: fieldToJson(f.array) }
				: { type: 'object', additionalProperties: fieldToJson(f.record) }
	const out: Record<string, unknown> = { ...inner }
	if (f.nullable) out.nullable = true
	return out
}

function fieldToTs(f: WireFieldType): string {
	const inner =
		'scalar' in f
			? SCALAR_TS[f.scalar]
			: 'array' in f
				? `${fieldToTs(f.array)}[]`
				: `Record<string, ${fieldToTs(f.record)}>`
	const nullSuffix = f.nullable ? ' | null' : ''
	const optSuffix = f.optional ? ' | undefined' : ''
	return inner + nullSuffix + optSuffix
}

/** Generate JSON Schema + TS for a struct; throws on unsupported fields. */
export function generateSchema(identity: SchemaIdentity, struct: WireStruct): GeneratedSchema {
	const properties: Record<string, unknown> = {}
	const required: string[] = []
	for (const [name, field] of Object.entries(struct.fields)) {
		if (
			field === null ||
			typeof field !== 'object' ||
			!('nullable' in field && 'optional' in field)
		)
			throw new Error(`unsupported field type for ${struct.name}.${name}`)
		properties[name] = fieldToJson(field)
		if (!field.optional) required.push(name)
	}
	const lines = Object.entries(struct.fields).map(
		([name, f]) => `  ${name}${f.optional ? '?' : ''}: ${fieldToTs(f)};`
	)
	return {
		identity,
		jsonSchema: {
			$id: schemaId(identity),
			type: 'object',
			properties,
			required,
			additionalProperties: false,
		},
		typeScript: `export interface ${struct.name} {\n${lines.join('\n')}\n}`,
	}
}
