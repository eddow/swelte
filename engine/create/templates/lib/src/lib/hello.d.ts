export interface HelloArgs {
	name: string
}
export function hello(args: HelloArgs): Promise<string>
