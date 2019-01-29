# Cluster-Cache

**Store, retrieve, share and persist cache data in clustered applications.**

One reason why we have to use Redis as cache storage is that we need to shared 
data inside multiple processes, for example, in clustered applications. Redis is
fast enough since it's based on memory, and reliable because it will 
occasionally flush data to file in order to backup.

However, the cluster itself could do the same thing. By using this package, an 
application can store data in the process memory, and sync them across the 
cluster. The data will be synced to file as well, and when a new process joining
in, the process can access the data as well.