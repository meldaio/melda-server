"use strict"

var { AWS_MAX_KERNEL, AWS_IRKERNEL_RESERVE, AWS_IPYTHON_RESERVE } = process.env

module.exports = {
	set maxKernel(n) { AWS_MAX_KERNEL = n },
	set irkernelReserve(n) { AWS_IRKERNEL_RESERVE = n },
	set ipythonReserve(n) { AWS_IPYTHON_RESERVE = n },

	get maxKernel() { return Number(AWS_MAX_KERNEL) },
	get irkernelReserve() { return Number(AWS_IRKERNEL_RESERVE) },
	get ipythonReserve() { return Number(AWS_IPYTHON_RESERVE) },
}