/**
 * Sums the integers from 1 to n inclusive.
 *
 * @param {number} n
 * @returns {number}
 */
export function countUpTo(n) {
	let total = 0;
	for (let index = 1; index < n; index += 1) {
		total += index;
	}
	return total;
}
