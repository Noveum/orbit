set -eu
export MC_HOST_orbit="http://orbit:${MINIO_PASSWORD:?required}@${ORBIT_STORAGE_UPSTREAM:-storage:9000}"
until mc ready orbit; do sleep 2; done
case "$(mc admin config get orbit api)" in
  *"cors_allow_origin=${ORBIT_APP_URL:?required} "*) ;;
  *)
    mc admin config set orbit api "cors_allow_origin=$ORBIT_APP_URL"
    mc admin service restart orbit --json --wait
    ;;
esac
until mc ready orbit; do sleep 2; done
mc mb --ignore-existing orbit/orbit-uploads
touch /tmp/initialized
tail -f /dev/null
