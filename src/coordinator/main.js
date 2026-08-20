function runCoordinatorSpike() {
  process.stdout.write("ASR_COORDINATOR_SEA_SMOKE_OK\n");
}

if (require.main === module) {
  runCoordinatorSpike();
}

module.exports = { runCoordinatorSpike };
