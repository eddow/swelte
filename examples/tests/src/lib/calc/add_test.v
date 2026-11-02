module calc

fn test_add() {
	assert add(AddArgs{ a: 2, b: 3 }) == 5
	assert add(AddArgs{ a: -1, b: 1 }) == 0
}
